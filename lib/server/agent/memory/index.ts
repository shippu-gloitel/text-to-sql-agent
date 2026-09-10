import { MemorySaver } from '@langchain/langgraph';

// In-memory approval checkpoints are scoped to this server process.
export const checkpointer = new MemorySaver();
