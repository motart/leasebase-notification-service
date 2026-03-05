import { createApp, startApp, checkDbConnection } from '@leasebase/service-common';
import { notificationsRouter } from './routes/notifications';

const app = createApp({
  healthChecks: [{ name: 'database', check: checkDbConnection }],
});

app.use('/internal/notifications', notificationsRouter);

startApp(app);
