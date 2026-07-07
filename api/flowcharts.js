// api/flowcharts.js — CRUD for flowcharts (Notes app)
//
// GET    /api/flowcharts          -> list (id, name, updated_at)
// GET    /api/flowcharts?id=...   -> single chart incl. data blob
// POST   /api/flowcharts          -> create { name? }
// PUT    /api/flowcharts          -> update { id, name?, data? }
// DELETE /api/flowcharts?id=...   -> delete
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET

import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import cookie from 'cookie';

const COOKIE_NAME = 'nt_token';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getUserId(req) {
  const token = cookie.parse(req.headers.cookie || '')[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.user_id || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    switch (req.method) {
      case 'GET': {
        const { id } = req.query;
        if (id) {
          const { data, error } = await supabase
            .from('flowcharts')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .single();
          if (error || !data) return res.status(404).json({ error: 'Not found' });
          return res.status(200).json(data);
        }
        const { data, error } = await supabase
          .from('flowcharts')
          .select('id, name, updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json(data);
      }

      case 'POST': {
        const { name } = req.body || {};
        const { data, error } = await supabase
          .from('flowcharts')
          .insert({
            user_id: userId,
            name: (name && String(name).trim()) || 'Untitled chart',
            data: { nodes: [], edges: [] },
          })
          .select()
          .single();
        if (error) throw error;
        return res.status(201).json(data);
      }

      case 'PUT': {
        const { id, name, data: graph } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });

        const patch = { updated_at: new Date().toISOString() };
        if (name !== undefined) patch.name = String(name).trim() || 'Untitled chart';
        if (graph !== undefined) {
          if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
            return res.status(400).json({ error: 'data must be { nodes: [], edges: [] }' });
          }
          patch.data = graph;
        }

        const { data, error } = await supabase
          .from('flowcharts')
          .update(patch)
          .eq('id', id)
          .eq('user_id', userId)
          .select('id, name, updated_at')
          .single();
        if (error || !data) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(data);
      }

      case 'DELETE': {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'id required' });
        const { error } = await supabase
          .from('flowcharts')
          .delete()
          .eq('id', id)
          .eq('user_id', userId);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      default:
        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('flowcharts api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
