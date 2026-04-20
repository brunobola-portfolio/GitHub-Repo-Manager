import express from 'express';
import azureRouter from './import/azure.js';
import urlRouter from './import/url.js';
import statusRouter from './import/status.js';

const router = express.Router();
router.use(azureRouter);
router.use(urlRouter);
router.use(statusRouter);

export default router;
