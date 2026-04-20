import express from 'express';
import gitRouter from './azure/git.js';
import tfvcRouter from './azure/tfvc.js';

const router = express.Router();
router.use(gitRouter);
router.use(tfvcRouter);

export default router;
