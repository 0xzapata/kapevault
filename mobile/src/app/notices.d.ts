// Made by vite.config.mjs from mobile/scripts/lib/notices.mjs on every build.
declare module "virtual:kapevault-notices" {
  const notices: { version: string; sections: { name: string; text: string }[] };
  export default notices;
}
