# @ahmedrowaihi/bull-board-fetch

Fetch adapter for [bull-board](https://github.com/felixmosh/bull-board). Works with Node.js 18+ and Bun using the web standard fetch API without requiring Hono or other frameworks.

## Installation

```bash
# With Bun
bun add @ahmedrowaihi/bull-board-fetch @bull-board/api

# With npm/yarn/pnpm
npm install @ahmedrowaihi/bull-board-fetch @bull-board/api
```

## Usage

```typescript
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FetchAdapter } from "@ahmedrowaihi/bull-board-fetch";
import { Queue } from "bullmq";

// Create your queues
const queue = new Queue("my-queue");

// Create the adapter
const serverAdapter = new FetchAdapter();
serverAdapter.setBasePath("/admin/queues");

// Create bull-board
createBullBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
});

// Get the fetch handler
const handler = serverAdapter.getFetchHandler();

// Use with Bun's native server
export default {
  port: 3000,
  fetch: handler,
};

// Or with Node.js 18+ (using a fetch-compatible server)
// Example with a simple Node.js server:
import { createServer } from "node:http";

const server = createServer(async (req, res) => {
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
  });

  const response = await handler(request);
  
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    const body = await response.arrayBuffer();
    res.end(Buffer.from(body));
  } else {
    res.end();
  }
});

server.listen(3000);
```

## Features

- ✅ Works with Bun's native fetch API
- ✅ No Web framework, Just webstandard
- ✅ Handles static file serving
- ✅ Supports base path configuration
- ✅ EJS template rendering for HTML views
- ✅ Automatic path prefix injection for static assets

## API

### `FetchAdapter`

#### Methods

- `setBasePath(path: string): this` - Set the base path for the dashboard
- `setStaticPath(staticRoute: string, staticPath: string): this` - Set static file route and path
- `setViewsPath(viewPath: string): this` - Set views/templates path
- `setErrorHandler(handler: (error: Error) => ControllerHandlerReturnType): this` - Set error handler
- `setApiRoutes(routes: readonly AppControllerRoute[]): this` - Set API routes
- `setEntryRoute(routeDef: AppViewRoute): this` - Set entry route (HTML view)
- `setQueues(bullBoardQueues: BullBoardQueues): this` - Set queues
- `setUIConfig(config: UIConfig): this` - Set UI configuration
- `getFetchHandler(): (request: Request) => Promise<Response>` - Get the fetch handler

## License

MPL-2.0

