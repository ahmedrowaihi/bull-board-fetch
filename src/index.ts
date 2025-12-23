/**
 * @ahmedrowaihi/bull-board-fetch
 *
 * Fetch adapter for bull-board
 * Implements IServerAdapter interface
 * Works with Node.js 18+ and Bun using web standard fetch API
 */

import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type {
  AppControllerRoute,
  AppViewRoute,
  BullBoardQueues,
  ControllerHandlerReturnType,
  HTTPMethod,
  IServerAdapter,
  UIConfig,
} from "@bull-board/api/typings/app";
import ejs from "ejs";

/**
 * Get content type from file extension
 */
function getContentType(ext: string): string {
  const contentTypes: Record<string, string> = {
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
  };

  return contentTypes[ext] || "application/octet-stream";
}

/**
 * Fetch Adapter for bull-board
 * Works with Node.js 18+ and Bun using web standard fetch API
 * Implements IServerAdapter without requiring Hono or other frameworks
 */
export class FetchAdapter implements IServerAdapter {
  protected bullBoardQueues: BullBoardQueues | undefined;
  protected errorHandler:
    | ((error: Error) => ControllerHandlerReturnType)
    | undefined;
  protected uiConfig?: UIConfig;
  protected staticRoute?: string;
  protected staticPath?: string;
  protected entryRoute?: AppViewRoute;
  protected viewPath?: string;
  protected apiRoutes: Map<
    string,
    Map<HTTPMethod, AppControllerRoute["handler"]>
  > = new Map();
  protected basePath = "/";

  public setBasePath(path: string): this {
    this.basePath = path;
    return this;
  }

  setStaticPath(staticRoute: string, staticPath: string): this {
    this.staticRoute = staticRoute;
    this.staticPath = staticPath;
    return this;
  }

  setViewsPath(viewPath: string): this {
    this.viewPath = viewPath;
    return this;
  }

  setErrorHandler(
    handler: (error: Error) => ControllerHandlerReturnType,
  ): this {
    this.errorHandler = handler;
    return this;
  }

  setApiRoutes(routes: readonly AppControllerRoute[]): this {
    const { errorHandler, bullBoardQueues } = this;

    if (!errorHandler || !bullBoardQueues) {
      throw new Error(
        "Please call 'setQueues' and 'setErrorHandler' before using 'setApiRoutes'",
      );
    }

    for (const { method: methodOrMethods, route, handler } of routes) {
      const methods = Array.isArray(methodOrMethods)
        ? methodOrMethods
        : [methodOrMethods];

      for (const m of methods) {
        this.registerRoute(route, m, handler);
      }
    }

    return this;
  }

  setEntryRoute(routeDef: AppViewRoute): this {
    this.entryRoute = routeDef;
    return this;
  }

  setQueues(bullBoardQueues: BullBoardQueues): this {
    this.bullBoardQueues = bullBoardQueues;
    return this;
  }

  setUIConfig(config: UIConfig): this {
    this.uiConfig = config;
    return this;
  }

  /**
   * Get the fetch handler for this adapter
   */
  getFetchHandler(): (request: Request) => Promise<Response> {
    if (!this.staticRoute || !this.staticPath) {
      throw new Error(
        `Please call 'setStaticPath' before using 'getFetchHandler'`,
      );
    }

    if (!this.entryRoute) {
      throw new Error(
        `Please call 'setEntryRoute' before using 'getFetchHandler'`,
      );
    }

    if (!this.viewPath) {
      throw new Error(
        `Please call 'setViewsPath' before using 'getFetchHandler'`,
      );
    }

    if (!this.uiConfig) {
      throw new Error(
        `Please call 'setUIConfig' before using 'getFetchHandler'`,
      );
    }

    return async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname.startsWith("/static")) {
        return this.handleStaticFile(pathname);
      }

      let path = pathname.replace(this.basePath, "") || "/";
      if (!path.startsWith("/")) {
        path = `/${path}`;
      }

      if (path.startsWith(this.staticRoute ?? "")) {
        return this.handleStaticFile(path);
      }

      const apiResponse = await this.handleApiRoute(request, path);
      if (apiResponse) {
        return apiResponse;
      }

      const routeOrRoutes = this.entryRoute?.route;
      const routes = Array.isArray(routeOrRoutes)
        ? routeOrRoutes
        : [routeOrRoutes];

      if (routes.some((r) => path === r || path === `${r}/`)) {
        return this.handleEntryRoute();
      }

      if (pathname.startsWith(this.basePath) && !path.startsWith("/api")) {
        return this.handleEntryRoute();
      }

      return new Response("Not Found", { status: 404 });
    };
  }

  private async handleStaticFile(path: string): Promise<Response> {
    try {
      let filePath = path;

      const staticBaseUrlPath = [this.basePath, this.staticRoute]
        .join("/")
        .replace(/\/{2,}/g, "/");
      if (path.startsWith(staticBaseUrlPath)) {
        filePath = path.replace(staticBaseUrlPath, "").replace(/^\//, "");
      } else if (path.startsWith("/static")) {
        filePath = path.replace("/static", "").replace(/^\//, "");
      } else if (path.startsWith(this.staticRoute ?? "")) {
        filePath = path.replace(this.staticRoute ?? "", "").replace(/^\//, "");
      }

      const staticPath = this.staticPath;
      if (!staticPath) {
        return new Response("Not Found", { status: 404 });
      }

      const fullPath = join(staticPath, filePath);

      try {
        const stats = statSync(fullPath);
        if (!stats.isFile()) {
          return new Response("Not Found", { status: 404 });
        }

        const fileContent = readFileSync(fullPath);

        const ext = extname(fullPath).toLowerCase();
        const contentType = getContentType(ext);

        return new Response(fileContent, {
          headers: {
            "Content-Type": contentType,
          },
        });
      } catch (error) {
        return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  private async handleApiRoute(
    request: Request,
    path: string,
  ): Promise<Response | null> {
    const method = request.method.toLowerCase() as HTTPMethod;

    for (const [routePattern, methods] of this.apiRoutes.entries()) {
      const handler = methods.get(method);
      if (!handler) {
        continue;
      }

      const params = this.matchRoute(routePattern, path);
      if (params !== null) {
        try {
          let reqBody = {};
          if (method !== "get") {
            try {
              reqBody = (await request.json()) as Record<string, unknown>;
            } catch {}
          }

          const bullBoardQueues = this.bullBoardQueues;
          if (!bullBoardQueues) {
            return new Response("Internal Server Error", { status: 500 });
          }

          const response = await handler({
            queues: bullBoardQueues,
            params,
            query: Object.fromEntries(
              new URL(request.url).searchParams.entries(),
            ),
            body: reqBody as Record<string, unknown>,
            headers: Object.fromEntries(request.headers.entries()),
          });

          if (response.status === 204) {
            return new Response(null, { status: 204 });
          }

          return Response.json(response.body, {
            status: response.status || 200,
          });
        } catch (e) {
          if (!this.errorHandler || !(e instanceof Error)) {
            throw e;
          }

          const response = this.errorHandler(e);
          const status = response.status !== 204 ? response.status : 500;

          if (typeof response.body === "string") {
            return new Response(response.body, { status });
          }

          return Response.json(response.body, { status });
        }
      }
    }

    return null;
  }

  private handleEntryRoute(): Response {
    try {
      const entryRoute = this.entryRoute;
      if (!entryRoute) {
        throw new Error("Entry route not set");
      }
      const { name: fileName, params } = entryRoute.handler({
        basePath: this.basePath,
        uiConfig: this.uiConfig ?? {},
      });

      const templatePath = join(this.viewPath ?? "", fileName);
      const template = readFileSync(templatePath, "utf-8");

      let rendered = ejs.render(template, params);

      if (this.basePath !== "/") {
        rendered = rendered.replace(
          /(src|href)="\/static\//g,
          `$1="${this.basePath}/static/`,
        );

        rendered = rendered.replace(
          /(src|href)="static\//g,
          `$1="${this.basePath}/static/`,
        );
      }

      return new Response(rendered, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  private matchRoute(
    pattern: string,
    path: string,
  ): Record<string, string> | null {
    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);

    if (patternParts.length !== pathParts.length) {
      return null;
    }

    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      if (patternPart?.startsWith(":")) {
        params[patternPart.slice(1)] = pathPart ?? "";
      } else if (patternPart !== pathPart) {
        return null;
      }
    }

    return params;
  }

  private registerRoute(
    routeOrRoutes: string | string[],
    method: HTTPMethod,
    handler: AppControllerRoute["handler"],
  ) {
    const { bullBoardQueues } = this;

    if (!bullBoardQueues) {
      throw new Error(`Please call 'setQueues' before using 'registerRoute'`);
    }

    const routeList = Array.isArray(routeOrRoutes)
      ? routeOrRoutes
      : [routeOrRoutes];

    for (const route of routeList) {
      if (!this.apiRoutes.has(route)) {
        this.apiRoutes.set(route, new Map());
      }
      const routeMap = this.apiRoutes.get(route);
      if (!routeMap) {
        throw new Error(`Route ${route} not found`);
      }
      routeMap.set(method, handler);
    }
  }
}
