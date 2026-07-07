// api/auth.js — passwordless auth for Notes
//
// GET  /api/auth?action=me        -> { user_id, username } or 401
// POST /api/auth?action=register  -> body { username }  creates user + session
// POST /api/auth?action=login     -> body { username }  session for existing user
// POST /api/auth?action=logout    -> clears session cookie
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET

import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import cookie from 'cookie';

const COOKIE_NAME = 'nt_token';
const SESSION_DAYS = 365;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function setSession(res, user) {
  const token = jwt.sign(
    { user_id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: SESSION_DAYS + 'd' }
  );
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  }));
}

function cleanUsername(raw) {
  const u = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,30}$/.test(u)) return null;
  return u;
}

export default async function handler(req, res) {
  const action = (req.query && req.query.action) || '';

  try {
    if (action === 'me') {
      const cookies = cookie.parse(req.headers.cookie || '');
      try {
        const p = jwt.verify(cookies[COOKIE_NAME], process.env.JWT_SECRET);
        return res.status(200).json({ user_id: p.user_id, username: p.username });
      } catch {
        return res.status(401).json({ error: 'Not signed in' });
      }
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (action === 'logout') {
      res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
        httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
      }));
      return res.status(200).json({ ok: true });
    }

    const username = cleanUsername((req.body || {}).username);
    if (!username) {
      return res.status(400).json({
        error: 'Username must be 3–30 characters: letters, numbers, _ or -',
      });
    }

    if (action === 'register') {
      const { data, error } = await supabase
        .from('users')
        .insert({ username })
        .select()
        .single();
      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'That username is taken — sign in instead.' });
        }
        throw error;
      }
      setSession(res, data);
      return res.status(201).json({ user_id: data.id, username: data.username });
    }

    if (action === 'login') {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .single();
      if (error || !data) {
        return res.status(401).json({ error: 'No account with that username — create one instead.' });
      }
      setSession(res, data);
      return res.status(200).json({ user_id: data.id, username: data.username });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('auth api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
