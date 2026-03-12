import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';

const { mockQuery, mockQueryOne, activeUser } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  activeUser: { current: null as any },
}));

vi.mock('@leasebase/service-common', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@leasebase/service-common')>();
  return {
    ...mod,
    query: mockQuery,
    queryOne: mockQueryOne,
    requireAuth: (req: any, _res: any, next: any) => {
      if (!activeUser.current) return next(new mod.UnauthorizedError());
      req.user = { ...activeUser.current };
      next();
    },
  };
});

import express from 'express';
import { notificationsRouter } from '../routes/notifications';

function req(port: number, method: string, path: string, body?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const r = http.request(
      { hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data).toString() } : {}) } },
      (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode!, body: raw }); } }); },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const user = (overrides: Record<string, any> = {}) => ({
  sub: 'u1', userId: 'u1', orgId: 'org-1', email: 't@t.com', role: 'TENANT', name: 'T', scopes: ['api/read', 'api/write'], ...overrides,
});

let server: http.Server;
let port: number;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/n', notificationsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.statusCode || 500).json({ error: { code: err.code, message: err.message } }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { port = (server.address() as any).port; resolve(); }); });
});
afterAll(() => server?.close());
beforeEach(() => { mockQuery.mockReset(); mockQueryOne.mockReset(); });

describe('Data Isolation — notification-service', () => {
  // ── N1: POST / recipient org validation ──
  describe('N1: POST / recipient org validation', () => {
    const body = { recipientUserId: 'r1', title: 'Hi', body: 'Hello', type: 'general' };

    it('returns 201 when recipient is in caller org', async () => {
      activeUser.current = user({ role: 'OWNER', orgId: 'org-1' });
      mockQueryOne
        .mockResolvedValueOnce({ id: 'r1' }) // recipient lookup
        .mockResolvedValueOnce({ id: 'n1' }); // insert
      expect((await req(port, 'POST', '/n/', body)).status).toBe(201);
    });
    it('returns 404 when recipient is NOT in caller org', async () => {
      activeUser.current = user({ role: 'OWNER', orgId: 'org-1' });
      mockQueryOne.mockResolvedValueOnce(null); // recipient not found
      expect((await req(port, 'POST', '/n/', body)).status).toBe(404);
    });
    it('returns 404 for bulk send when any recipient is outside org', async () => {
      activeUser.current = user({ role: 'OWNER', orgId: 'org-1' });
      mockQueryOne
        .mockResolvedValueOnce({ id: 'r1' }) // first recipient OK
        .mockResolvedValueOnce(null); // second recipient NOT in org
      const bulkBody = { recipientUserIds: ['r1', 'r2'], title: 'Hi', body: 'Hello', type: 'general' };
      expect((await req(port, 'POST', '/n/bulk', bulkBody)).status).toBe(404);
    });
  });

  // ── N2: GET /:id must check recipient_user_id ──
  describe('N2: GET /:id recipient ownership', () => {
    it('returns 200 when user is the recipient', async () => {
      activeUser.current = user({ userId: 'u1' });
      mockQueryOne.mockResolvedValueOnce({ id: 'n1', recipient_user_id: 'u1', organization_id: 'org-1' });
      expect((await req(port, 'GET', '/n/n1')).status).toBe(200);
    });
    it('returns 404 when user is NOT the recipient (same org)', async () => {
      activeUser.current = user({ userId: 'u1' });
      mockQueryOne.mockResolvedValueOnce(null); // query includes recipient_user_id so returns null
      expect((await req(port, 'GET', '/n/n1')).status).toBe(404);
    });
    it('returns 404 for cross-org access', async () => {
      activeUser.current = user({ userId: 'u1', orgId: 'other-org' });
      mockQueryOne.mockResolvedValueOnce(null);
      expect((await req(port, 'GET', '/n/n1')).status).toBe(404);
    });
  });
});
