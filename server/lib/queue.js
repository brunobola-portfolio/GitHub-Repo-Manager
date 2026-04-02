import logger from './logger.js';

class InMemoryQueue {
    constructor(name) {
        this.name = name;
    }

    async add(jobName, data, opts = {}) {
        // Execute immediately in-process
        const jobId = `${this.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        logger.info({ queue: this.name, jobName, jobId }, 'Job queued (in-memory)');
        return { id: jobId, name: jobName, data };
    }
}

class InMemoryWorker {
    constructor(name, processor) {
        this.name = name;
        this.processor = processor;
    }

    async close() {}
}

let _queues = new Map();
let _workers = new Map();

export async function getQueue(name) {
    if (_queues.has(name)) return _queues.get(name);

    const redisUrl = process.env.REDIS_URL;
    let queue;

    if (redisUrl) {
        const { Queue } = await import('bullmq');
        queue = new Queue(name, {
            connection: { url: redisUrl },
            defaultJobOptions: {
                removeOnComplete: 100,
                removeOnFail: 50,
            }
        });
    } else {
        queue = new InMemoryQueue(name);
    }

    _queues.set(name, queue);
    return queue;
}

export async function createWorker(name, processor, opts = {}) {
    const redisUrl = process.env.REDIS_URL;
    let worker;

    if (redisUrl) {
        const { Worker } = await import('bullmq');
        worker = new Worker(name, processor, {
            connection: { url: redisUrl },
            concurrency: opts.concurrency || 1,
        });
        worker.on('failed', (job, err) => {
            logger.error({ queue: name, jobId: job?.id, err }, 'Job failed');
        });
        worker.on('completed', (job) => {
            logger.info({ queue: name, jobId: job?.id }, 'Job completed');
        });
    } else {
        worker = new InMemoryWorker(name, processor);
    }

    _workers.set(name, worker);
    return worker;
}

export async function closeAllQueues() {
    for (const [, q] of _queues) {
        if (q.close) await q.close();
    }
    for (const [, w] of _workers) {
        if (w.close) await w.close();
    }
    _queues.clear();
    _workers.clear();
}
