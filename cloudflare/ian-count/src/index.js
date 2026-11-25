// Entry point for wrangler: the Worker (src/worker.js, testable in plain Node) plus the Durable Object class it binds.
import worker from './worker.js';
export { IanCount } from './counter.js';
export default worker;
