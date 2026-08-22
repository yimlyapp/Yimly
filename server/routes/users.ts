import { Router } from 'express';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq, ne } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const userSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8).optional(),
  role: z.enum(['administrator', 'user']).default('user'),
});

router.get('/', async (req, res) => {
  try {
    const allUsers = await db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users);
    res.json(allUsers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/', async (req, res) => {
  try {
    const parsed = userSchema.parse(req.body);
    if (!parsed.password) {
      return res.status(400).json({ error: 'Password is required for new users' });
    }

    const existingUser = await db.select().from(users).where(eq(users.username, parsed.username)).limit(1);
    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(parsed.password, 10);
    const newUser = await db.insert(users).values({
      username: parsed.username,
      password: hashedPassword,
      role: parsed.role,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning({
      id: users.id,
      username: users.username,
      role: users.role,
    });

    res.json(newUser[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const parsed = userSchema.parse(req.body);

    const updateData: any = {
      username: parsed.username,
      role: parsed.role,
      updatedAt: new Date(),
    };

    if (parsed.password) {
      updateData.password = await bcrypt.hash(parsed.password, 10);
    }

    // Check if modifying self role
    const reqUser = (req as any).user;
    if (reqUser.id === id && parsed.role !== 'administrator') {
      return res.status(400).json({ error: 'Cannot remove your own administrator role' });
    }

    const updatedUser = await db.update(users).set(updateData).where(eq(users.id, id)).returning({
      id: users.id,
      username: users.username,
      role: users.role,
    });

    if (updatedUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(updatedUser[0]);
  } catch (error) {
     if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const reqUser = (req as any).user;

    if (reqUser.id === id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    const deleted = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    if (deleted.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
