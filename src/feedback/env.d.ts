// The feedback inbox's code, read only by the dev server from
// .env.development.local (see feedbackApi.ts). Declared here, beside the code
// that reads it, so src/vite-env.d.ts stays as it is. Never set it for a
// production build.
interface ImportMetaEnv {
  readonly VITE_FEEDBACK_ADMIN_CODE?: string;
  // Where feedback is sent, in place of the feedback Lambda function on AWS
  // (or, when it is a localhost address, of 127.0.0.1:8788 on the dev server).
  readonly VITE_FEEDBACK_API_BASE?: string;
}
