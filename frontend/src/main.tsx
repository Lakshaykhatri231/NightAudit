import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen"; // generated from src/routes by the TanStack Router Vite plugin
import "./styles.css";

const router = createRouter({ routeTree, scrollRestoration: true });

// Lets TypeScript check route paths and params in <Link> and navigate().
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
