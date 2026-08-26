import fs from 'fs';

const content = `import { Router } from 'express';
import { db } from '../db/index.js';
import { playlists, playlistSongs, songs, artists, albums, users, playlistShares } from '../db/schema.js';
import { eq, and, or, asc, sql } from 'drizzle-orm';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';
import { z } from 'zod';

const router = Router();
router.use(requireAuth);

const playlistCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional().default(false),
});

const playlistUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
});

// List all playlists belonging to the user AND shared with the user (or all if admin)
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'administrator';

    let allPlaylists;
    if (isAdmin) {
      allPlaylists = await db.select({
        id: playlists.id,
        userId: playlists.userId,
        name: playlists.name,
        description: playlists.description,
        isPublic: playlists.isPublic,
        createdAt: playlists.createdAt,
        updatedAt: playlists.updatedAt,
        ownerName: users.username,
        songCount: sql<number>\`(SELECT count(*) FROM playlist_songs WHERE playlist_songs.playlist_id = playlists.id)\`,
      })
      .from(playlists)
      .leftJoin(users, eq(playlists.userId, users.id))
      .orderBy(asc(playlists.name));
    } else {
      // Need distinct because of leftJoin
      allPlaylists = await db.selectDistinct({
        id: playlists.id,
        userId: playlists.userId,
        name: playlists.name,
        description: playlists.description,
        isPublic: playlists.isPublic,
        createdAt: playlists.createdAt,
        updatedAt: playlists.updatedAt,
        ownerName: users.username,
        songCount: sql<number>\`(SELECT count(*) FROM playlist_songs WHERE playlist_songs.playlist_id = playlists.id)\`,
        sharePermission: playlistShares.permission,
      })
      .from(playlists)
      .leftJoin(users, eq(playlists.userId, users.id))
      .leftJoin(playlistShares, eq(playlists.id, playlistShares.playlistId))
      .where(or(eq(playlists.userId, userId!), eq(playlistShares.userId, userId!)))
      .orderBy(asc(playlists.name));
    }

    const formatted = allPlaylists.map((p: any) => ({
      ...p,
      isPublic: p.isPublic === 1,
      isOwner: p.userId === userId,
      canEdit: p.userId === userId || isAdmin || p.sharePermission === 'edit',
      permission: p.userId === userId ? 'owner' : (p.sharePermission || 'none')
    }));

    // Remove duplicates if the query returned any due to multiple shares (shouldn't happen with distinct, but just in case)
    const unique = Array.from(new Map(formatted.map(item => [item.id, item])).values());
    unique.sort((a, b) => a.name.localeCompare(b.name));

    res.json(unique);
  } catch (error) {
    console.error('Failed to fetch playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// Create a new playlist (server determines owner from authentication, client-supplied userId is ignored)
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Ensure client cannot supply userId
    if (req.body && ('userId' in req.body || 'user_id' in req.body)) {
      delete req.body.userId;
      delete req.body.user_id;
    }

    const parsed = playlistCreateSchema.parse(req.body);

    const now = new Date();
    const created = await db.insert(playlists).values({
      userId,
      name: parsed.name.trim(),
      description: parsed.description?.trim() || null,
      isPublic: parsed.isPublic ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    }).returning();

    res.status(201).json({
      ...created[0],
      isPublic: created[0].isPublic === 1,
      isOwner: true,
      canEdit: true,
      songs: [],
      permission: 'owner'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to create playlist' });
    }
  }
});

// Helper function to get playlist and check access
async function getPlaylistAndAccess(playlistId: number, reqUser: any) {
  const userId = reqUser?.id;
  const isAdmin = reqUser?.role === 'administrator';

  const playlist = await db.select({
    id: playlists.id,
    userId: playlists.userId,
    name: playlists.name,
    description: playlists.description,
    isPublic: playlists.isPublic,
    createdAt: playlists.createdAt,
    updatedAt: playlists.updatedAt,
    ownerName: users.username,
  })
  .from(playlists)
  .leftJoin(users, eq(playlists.userId, users.id))
  .where(eq(playlists.id, playlistId))
  .limit(1);

  if (playlist.length === 0) return { playlist: null, access: null };

  const p = playlist[0];
  const isOwner = p.userId === userId;

  let sharePermission = null;
  if (!isOwner && !isAdmin) {
    const share = await db.select().from(playlistShares)
      .where(and(eq(playlistShares.playlistId, playlistId), eq(playlistShares.userId, userId)))
      .limit(1);
    if (share.length > 0) {
      sharePermission = share[0].permission;
    }
  }

  const canView = isOwner || isAdmin || p.isPublic === 1 || sharePermission !== null;
  const canEdit = isOwner || isAdmin || sharePermission === 'edit';

  return {
    playlist: p,
    access: { isOwner, isAdmin, sharePermission, canView, canEdit }
  };
}

// Get playlist by ID with ordered songs
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist: p, access } = await getPlaylistAndAccess(id, req.user);

    if (!p) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (!access?.canView) {
      return res.status(403).json({ error: 'Forbidden. Access denied.' });
    }

    // Fetch songs in playlist
    const pSongs = await db.select({
      playlistSongId: playlistSongs.id,
      position: playlistSongs.position,
      addedAt: playlistSongs.addedAt,
      id: songs.id,
      title: songs.title,
      artistId: songs.artistId,
      artist: artists.name,
      albumId: songs.albumId,
      album: albums.title,
      duration: songs.duration,
      variant: songs.variant,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
    })
    .from(playlistSongs)
    .innerJoin(songs, eq(playlistSongs.songId, songs.id))
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(eq(playlistSongs.playlistId, id))
    .orderBy(asc(playlistSongs.position), asc(playlistSongs.addedAt));

    const songIds = pSongs.map(s => s.id);
    const artistsMap = await getSongArtistsMap(songIds);

    const formattedSongs = pSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      return {
        playlistSongId: s.playlistSongId,
        position: s.position,
        addedAt: s.addedAt,
        id: s.id,
        title: s.title,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        album: s.album,
        albumId: s.albumId,
        duration: s.duration,
        variant: s.variant,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
      };
    });

    res.json({
      ...p,
      isPublic: p.isPublic === 1,
      isOwner: access.isOwner,
      canEdit: access.canEdit,
      permission: access.isOwner ? 'owner' : (access.sharePermission || 'none'),
      songs: formattedSongs,
    });
  } catch (error) {
    console.error('Failed to fetch playlist:', error);
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// Update playlist details (PUT/PATCH) -> Owner ONLY
const handlePlaylistUpdate = async (req: AuthenticatedRequest, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.isOwner && !access?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden. Only the owner can edit playlist details.' });
    }

    const parsed = playlistUpdateSchema.parse(req.body);
    const updateData: any = { updatedAt: new Date() };
    if (parsed.name !== undefined) updateData.name = parsed.name.trim();
    if (parsed.description !== undefined) updateData.description = parsed.description?.trim() || null;
    if (parsed.isPublic !== undefined) updateData.isPublic = parsed.isPublic ? 1 : 0;

    const updated = await db.update(playlists).set(updateData).where(eq(playlists.id, id)).returning();

    res.json({
      ...updated[0],
      isPublic: updated[0].isPublic === 1,
      isOwner: true,
      canEdit: true,
      permission: 'owner'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to update playlist' });
    }
  }
};

router.put('/:id', handlePlaylistUpdate);
router.patch('/:id', handlePlaylistUpdate);

// Delete playlist -> Owner ONLY
router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.isOwner && !access?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden. Only the owner can delete this playlist.' });
    }

    await db.delete(playlistShares).where(eq(playlistShares.playlistId, id));
    await db.delete(playlistSongs).where(eq(playlistSongs.playlistId, id));
    await db.delete(playlists).where(eq(playlists.id, id));

    res.json({ message: 'Playlist deleted successfully' });
  } catch (error) {
    console.error('Failed to delete playlist:', error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

// Add song to playlist (Owner or Edit)
router.post('/:id/songs', async (req: AuthenticatedRequest, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    if (isNaN(playlistId)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { songId, position } = req.body;
    const sId = Number(songId);
    if (!songId || isNaN(sId)) {
      return res.status(400).json({ error: 'Valid songId is required' });
    }

    const { playlist, access } = await getPlaylistAndAccess(playlistId, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to modify this playlist.' });
    }

    const song = await db.select().from(songs).where(eq(songs.id, sId)).limit(1);
    if (song.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Check duplicate policy (prevent duplicate songs within a playlist)
    const duplicateCheck = await db.select()
      .from(playlistSongs)
      .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.songId, sId)))
      .limit(1);

    if (duplicateCheck.length > 0) {
      return res.status(400).json({ error: 'Song is already in this playlist' });
    }

    let itemPos = Number(position);
    if (isNaN(itemPos)) {
      const currSongs = await db.select({ position: playlistSongs.position })
        .from(playlistSongs)
        .where(eq(playlistSongs.playlistId, playlistId));
      itemPos = currSongs.length > 0 ? Math.max(...currSongs.map(s => s.position)) + 1 : 0;
    }

    const inserted = await db.insert(playlistSongs).values({
      playlistId,
      songId: sId,
      position: itemPos,
      addedAt: new Date(),
    }).returning();

    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));

    res.status(201).json(inserted[0]);
  } catch (error) {
    console.error('Failed to add song to playlist:', error);
    res.status(500).json({ error: 'Failed to add song to playlist' });
  }
});

// Reorder playlist songs (Owner or Edit)
router.patch('/:id/songs/reorder', async (req: AuthenticatedRequest, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    if (isNaN(playlistId)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(playlistId, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to modify this playlist.' });
    }

    const { songIds, items } = req.body;

    if (Array.isArray(songIds)) {
      for (let i = 0; i < songIds.length; i++) {
        const sId = Number(songIds[i]);
        if (!isNaN(sId)) {
          await db.update(playlistSongs)
            .set({ position: i })
            .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.songId, sId)));
        }
      }
    } else if (Array.isArray(items)) {
      for (const item of items) {
        const pos = Number(item.position);
        if (!isNaN(pos)) {
          if (item.songId) {
            await db.update(playlistSongs)
              .set({ position: pos })
              .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.songId, Number(item.songId))));
          } else if (item.playlistSongId || item.id) {
            const entryId = Number(item.playlistSongId || item.id);
            await db.update(playlistSongs)
              .set({ position: pos })
              .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.id, entryId)));
          }
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid reorder payload.' });
    }

    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));

    res.json({ message: 'Playlist songs reordered successfully' });
  } catch (error) {
    console.error('Failed to reorder playlist songs:', error);
    res.status(500).json({ error: 'Failed to reorder playlist songs' });
  }
});

// Remove song from playlist (Owner or Edit)
router.delete('/:id/songs/:songOrEntryId', async (req: AuthenticatedRequest, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    const targetId = parseInt(req.params.songOrEntryId);
    if (isNaN(playlistId) || isNaN(targetId)) return res.status(400).json({ error: 'Invalid IDs' });

    const { playlist, access } = await getPlaylistAndAccess(playlistId, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to modify this playlist.' });
    }

    let deleted = await db.delete(playlistSongs)
      .where(and(eq(playlistSongs.id, targetId), eq(playlistSongs.playlistId, playlistId)))
      .returning();

    if (deleted.length === 0) {
      deleted = await db.delete(playlistSongs)
        .where(and(eq(playlistSongs.songId, targetId), eq(playlistSongs.playlistId, playlistId)))
        .returning();
    }

    if (deleted.length === 0) {
      return res.status(404).json({ error: 'Song entry not found in playlist' });
    }

    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));

    res.json({ message: 'Song removed from playlist successfully' });
  } catch (error) {
    console.error('Failed to remove song from playlist:', error);
    res.status(500).json({ error: 'Failed to remove song from playlist' });
  }
});

// ==========================================
// SHARED PLAYLIST ENDPOINTS
// ==========================================

const shareSchema = z.object({
  username: z.string().min(1),
  permission: z.enum(['view', 'edit']).default('view')
});

// List collaborators
router.get('/:id/collaborators', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canView) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const shares = await db.select({
      id: playlistShares.id,
      userId: users.id,
      username: users.username,
      permission: playlistShares.permission,
      createdAt: playlistShares.createdAt
    })
    .from(playlistShares)
    .innerJoin(users, eq(playlistShares.userId, users.id))
    .where(eq(playlistShares.playlistId, id))
    .orderBy(asc(users.username));

    res.json(shares);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list collaborators' });
  }
});

// Share playlist with a user (Owner ONLY)
router.post('/:id/share', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.isOwner && !access?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden. Only owner can share.' });
    }

    const parsed = shareSchema.parse(req.body);

    const targetUser = await db.select().from(users).where(eq(users.username, parsed.username)).limit(1);
    if (targetUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser[0].id === playlist.userId) {
      return res.status(400).json({ error: 'Cannot share with the owner' });
    }

    // Upsert the share
    const existingShare = await db.select().from(playlistShares)
      .where(and(eq(playlistShares.playlistId, id), eq(playlistShares.userId, targetUser[0].id)))
      .limit(1);

    if (existingShare.length > 0) {
      await db.update(playlistShares)
        .set({ permission: parsed.permission })
        .where(eq(playlistShares.id, existingShare[0].id));
      
      return res.json({ message: 'Share updated', permission: parsed.permission });
    } else {
      const inserted = await db.insert(playlistShares).values({
        playlistId: id,
        userId: targetUser[0].id,
        permission: parsed.permission,
        createdAt: new Date()
      }).returning();
      
      return res.status(201).json(inserted[0]);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to share playlist' });
    }
  }
});

// Remove collaborator (Owner ONLY)
router.delete('/:id/share/:userId', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);
    if (isNaN(id) || isNaN(targetUserId)) return res.status(400).json({ error: 'Invalid ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.isOwner && !access?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db.delete(playlistShares)
      .where(and(eq(playlistShares.playlistId, id), eq(playlistShares.userId, targetUserId)));

    res.json({ message: 'Collaborator removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

// Leave shared playlist (Collaborator)
router.post('/:id/leave', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const deleted = await db.delete(playlistShares)
      .where(and(eq(playlistShares.playlistId, id), eq(playlistShares.userId, userId)))
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({ error: 'You are not a collaborator on this playlist' });
    }

    res.json({ message: 'Successfully left the playlist' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave playlist' });
  }
});

export default router;
`

fs.writeFileSync('server/routes/playlists.ts', content);
