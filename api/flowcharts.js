// api/flowcharts.js — CRUD for flowcharts + folders (Notes app)
//
// Flowcharts:
//   GET    /api/flowcharts                    -> list (id, name, updated_at, folder_id)
//   GET    /api/flowcharts?id=...             -> single chart incl. data blob
//   POST   /api/flowcharts                    -> create { name?, folder_id? }
//   PUT    /api/flowcharts                    -> update { id, name?, data?, folder_id? }
//   DELETE /api/flowcharts?id=...             -> delete
//
// Folders (resource=folders):
//   GET    /api/flowcharts?resource=folders           -> list folders
//   POST   /api/flowcharts?resource=folders           -> create { name? }
//   PUT    /api/flowcharts?resource=folders           -> rename { id, name }
//   DELETE /api/flowcharts?resource=folders&id=...&mode=folder|contents
//            mode=folder   -> delete folder only, charts become uncategorised (default)
//            mode=contents -> delete folder AND all charts inside it
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

  const resource = req.query && req.query.resource;

  try {
    // ── FOLDERS ───────────────────────────────────────────────────────────────
    if (resource === 'folders') {
      switch (req.method) {
        case 'GET': {
          const { data, error } = await supabase
            .from('notes_folders')
            .select('id, name, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });
          if (error) throw error;
          return res.status(200).json(data);
        }
        case 'POST': {
          const { name } = req.body || {};
          const { data, error } = await supabase
            .from('notes_folders')
            .insert({ user_id: userId, name: (name && String(name).trim()) || 'New folder' })
            .select()
            .single();
          if (error) throw error;
          return res.status(201).json(data);
        }
        case 'PUT': {
          const { id, name } = req.body || {};
          if (!id) return res.status(400).json({ error: 'id required' });
          const { data, error } = await supabase
            .from('notes_folders')
            .update({ name: String(name || '').trim() || 'New folder' })
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();
          if (error || !data) return res.status(404).json({ error: 'Not found' });
          return res.status(200).json(data);
        }
        case 'DELETE': {
          const { id, mode } = req.query;
          if (!id) return res.status(400).json({ error: 'id required' });
          if (mode === 'contents') {
            // delete charts inside first
            const { error: cErr } = await supabase
              .from('notes_flowcharts')
              .delete()
              .eq('folder_id', id)
              .eq('user_id', userId);
            if (cErr) throw cErr;
          }
          // (default) folder-only: FK on delete set null uncategorises charts automatically
          const { error } = await supabase
            .from('notes_folders')
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
    }

    // ── FLOWCHARTS ────────────────────────────────────────────────────────────
    switch (req.method) {
      case 'GET': {
        const { id } = req.query;
        if (id) {
          const { data, error } = await supabase
            .from('notes_flowcharts')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .single();
          if (error || !data) return res.status(404).json({ error: 'Not found' });
          return res.status(200).json(data);
        }
        const { data, error } = await supabase
          .from('notes_flowcharts')
          .select('id, name, updated_at, folder_id')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json(data);
      }

      case 'POST': {
        const { name, folder_id } = req.body || {};
        const { data, error } = await supabase
          .from('notes_flowcharts')
          .insert({
            user_id: userId,
            name: (name && String(name).trim()) || 'Untitled chart',
            data: { nodes: [], edges: [], types: [] },
            folder_id: folder_id || null,
          })
          .select()
          .single();
        if (error) throw error;
        return res.status(201).json(data);
      }

      case 'PUT': {
        const { id, name, data: graph, folder_id } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });

        const patch = { updated_at: new Date().toISOString() };
        if (name !== undefined) patch.name = String(name).trim() || 'Untitled chart';
        if (graph !== undefined) {
          if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
            return res.status(400).json({ error: 'data must be { nodes: [], edges: [] }' });
          }
          patch.data = graph;
        }
        // folder_id: allow explicit null (uncategorise) — only touch if key present
        if (Object.prototype.hasOwnProperty.call(req.body, 'folder_id')) {
          patch.folder_id = folder_id || null;
        }

        const { data, error } = await supabase
          .from('notes_flowcharts')
          .update(patch)
          .eq('id', id)
          .eq('user_id', userId)
          .select('id, name, updated_at, folder_id')
          .single();
        if (error || !data) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(data);
      }

      case 'DELETE': {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'id required' });
        const { error } = await supabase
          .from('notes_flowcharts')
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
