import fs from 'fs';
import path from 'path';

import { Worker } from 'worker_threads';

interface NodeProcessConfig {
  maxWorkers: number;
  worker: (data:any) => Promise<any>;
}

export default class NodeProcess {
  private maxWorkers: number;

  private worker: (data:any) => Promise<any>;

  private workerPool: Worker[] = [];

  private waiting: ((worker: Worker) => void)[] = [];

  constructor(cfg: NodeProcessConfig) {
    this.maxWorkers = cfg.maxWorkers;
    this.worker = cfg.worker;

    if (!this.maxWorkers) {
      this.maxWorkers = 1;
    }

    if (!this.worker) {
      throw new Error('worker function is required');
    }
    const filePath = `${path.dirname(__filename)}/process-node-worker.js`;
    fs.writeFileSync(filePath, this.generateFunctionString());

    for (let i = 0; i < this.maxWorkers; i++) {
      this.workerPool.push(
        new Worker(filePath),
      );
    }
  }

  private generateFunctionString() {
    return `
    const { parentPort } = require('worker_threads');

    parentPort.on('message', (_1) => {
      const _3 = ${this.worker.toString()};

      Promise.resolve(_3(_1)).then((_2) => {
        parentPort.postMessage(_2);
      });
    });

    `;
  }

  public async process(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const worker = this.workerPool.shift();

      if (!worker) {
        this.waiting.push((workerHandle: Worker) => {
          this.handle(workerHandle, data).then(resolve).catch(reject);
        });
      } else {
        this.handle(worker, data).then(resolve).catch(reject);
      }
    });
  }

  private async handle(worker: Worker, data: any): Promise<any> {
    worker.postMessage(data);

    return new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    }).then((result: any) => {
      if (this.waiting.length > 0) {
        const waiting = this.waiting.shift();
        if (waiting) waiting(worker);
      } else {
        this.workerPool.push(worker);
      }

      return result;
    });
  }
}
