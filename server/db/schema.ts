import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role', { enum: ['administrator', 'user'] }).notNull().default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  roomCode: text('room_code').notNull().unique(),
  hostId: integer('host_id').references(() => users.id).notNull(),
  hostDevice: text('host_device').notNull(),
  status: text('status', { enum: ['active', 'closed'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const controllers = sqliteTable('controllers', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id).notNull(),
  userId: integer('user_id').references(() => users.id), // Can be null for guest controllers? The instructions say "User" so let's allow it.
  device: text('device').notNull(),
  connectionState: text('connection_state').notNull().default('connected'),
  lastSeenTime: integer('last_seen_time', { mode: 'timestamp' }).notNull(),
});

export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  lastScan: integer('last_scan', { mode: 'timestamp' }),
});

export const artists = sqliteTable('artists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  artworkPath: text('artwork_path'),
});

export const albums = sqliteTable('albums', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  artistId: integer('artist_id').references(() => artists.id).notNull(),
  title: text('title').notNull(),
  year: integer('year'),
  artworkPath: text('artwork_path'),
});

export const songs = sqliteTable('songs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id').references(() => libraries.id).notNull(),
  artistId: integer('artist_id').references(() => artists.id).notNull(),
  albumId: integer('album_id').references(() => albums.id),
  title: text('title').notNull(),
  mainAudioPath: text('main_audio_path').notNull(),
  instrumentalAudioPath: text('instrumental_audio_path'),
  duration: integer('duration'), // seconds
  trackNumber: integer('track_number'),
  discNumber: integer('disc_number'),
  genre: text('genre'),
  year: integer('year'),
  variant: text('variant').notNull().default('original'),
  fileSize: integer('file_size'),
  format: text('format'),
  artworkPath: text('artwork_path'),
});

export const lyrics = sqliteTable('lyrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  songId: integer('song_id').references(() => songs.id).notNull(),
  lrcPath: text('lrc_path').notNull(),
});

export const songArtists = sqliteTable('song_artists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  songId: integer('song_id').references(() => songs.id).notNull(),
  artistId: integer('artist_id').references(() => artists.id).notNull(),
  position: integer('position').notNull().default(0),
});

export const queueItems = sqliteTable('queue_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').references(() => sessions.id).notNull(),
  songId: integer('song_id').references(() => songs.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(), // singer
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
  position: integer('position').notNull(),
  status: text('status', { enum: ['pending', 'playing', 'finished'] }).notNull().default('pending'),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
