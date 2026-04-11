import cors from 'cors';
import express from 'express';
import { env } from './env';
import { v1Router } from './routes/v1';

const app = express();
app.use(cors({ origin: ['http://localhost:5173'], credentials: true }));
app.use(express.json());
app.use('/api/v1', v1Router);

app.listen(env.port, () => {
  console.log(`API gateway (Express) listening on http://localhost:${env.port}`);
});
