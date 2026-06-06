// Ambient module declarations for packages that ship no TypeScript types.

// swagger-ui-dist ships as a standalone UMD bundle without type declarations.
// The constructor is called imperatively via useEffect; we type it loosely here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module "swagger-ui-dist/swagger-ui-bundle.js" {
  const SwaggerUIBundle: (config: Record<string, unknown>) => void;
  export default SwaggerUIBundle;
}
