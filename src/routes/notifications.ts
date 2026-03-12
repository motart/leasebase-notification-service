import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  requireAuth, requireRole, validateBody,
  query, queryOne, NotFoundError,
  parsePagination, paginationMeta, logger,
  type AuthenticatedRequest, UserRole,
} from '@leasebase/service-common';

const router = Router();

// Note: In production, notifications would also be queued via SQS.
// The SQS_QUEUE_URL env var configures the queue for async dispatch.

const sendNotificationSchema = z.object({
  recipientUserId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  type: z.string().default('general'),
  relatedType: z.string().optional(),
  relatedId: z.string().optional(),
});

// GET / - List notifications for current user
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const pg = parsePagination(req.query as Record<string, unknown>);
    const offset = (pg.page - 1) * pg.limit;
    const [rows, countResult] = await Promise.all([
      query(`SELECT * FROM notifications WHERE recipient_user_id = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [user.userId, user.orgId, pg.limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM notifications WHERE recipient_user_id = $1 AND organization_id = $2`,
        [user.userId, user.orgId]),
    ]);
    res.json({ data: rows, meta: paginationMeta(Number(countResult?.count || 0), pg) });
  } catch (err) { next(err); }
});

// POST / - Send notification
router.post('/', requireAuth, requireRole(UserRole.OWNER),
  validateBody(sendNotificationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { recipientUserId, title, body, type, relatedType, relatedId } = req.body;

      // Verify recipient belongs to caller's org
      const recipient = await queryOne(
        `SELECT id FROM "User" WHERE id = $1 AND "organizationId" = $2`,
        [recipientUserId, user.orgId],
      );
      if (!recipient) throw new NotFoundError('Recipient not found');

      const row = await queryOne(
        `INSERT INTO notifications (organization_id, recipient_user_id, sender_user_id, title, body, type, related_type, related_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [user.orgId, recipientUserId, user.userId, title, body, type, relatedType || null, relatedId || null]
      );
      // TODO: Also push to SQS_QUEUE_URL if configured
      logger.info({ notificationId: (row as any)?.id }, 'Notification created');
      res.status(201).json({ data: row });
    } catch (err) { next(err); }
  }
);

// GET /:id — user can only read their own notifications
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const row = await queryOne(
      `SELECT * FROM notifications WHERE id = $1 AND recipient_user_id = $2 AND organization_id = $3`,
      [req.params.id, user.userId, user.orgId]
    );
    if (!row) throw new NotFoundError('Notification not found');
    res.json({ data: row });
  } catch (err) { next(err); }
});

// PATCH /:id/read - Mark as read
router.patch('/:id/read', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const row = await queryOne(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND recipient_user_id = $2 AND organization_id = $3 RETURNING *`,
      [req.params.id, user.userId, user.orgId]
    );
    if (!row) throw new NotFoundError('Notification not found');
    res.json({ data: row });
  } catch (err) { next(err); }
});

// POST /bulk - Bulk send
router.post('/bulk', requireAuth, requireRole(UserRole.OWNER),
  validateBody(z.object({
    recipientUserIds: z.array(z.string().min(1)).min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    type: z.string().default('general'),
  })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { recipientUserIds, title, body, type } = req.body;

      // Verify all recipients belong to caller's org
      for (const recipientId of recipientUserIds) {
        const recipient = await queryOne(
          `SELECT id FROM "User" WHERE id = $1 AND "organizationId" = $2`,
          [recipientId, user.orgId],
        );
        if (!recipient) throw new NotFoundError('Recipient not found');
      }

      const results = [];
      for (const recipientId of recipientUserIds) {
        const row = await queryOne(
          `INSERT INTO notifications (organization_id, recipient_user_id, sender_user_id, title, body, type)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [user.orgId, recipientId, user.userId, title, body, type]
        );
        results.push(row);
      }
      res.status(201).json({ data: results, meta: { sent: results.length } });
    } catch (err) { next(err); }
  }
);

export { router as notificationsRouter };
