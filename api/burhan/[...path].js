/*!
 * api/burhan/[...path].js — بوّابة «برهان نماء» بصيغة دالة Vercel Edge
 *
 * المنطق كلّه في gateway/burhan-gateway.js — هذه الدالة تمرّر إليه متغيرات
 * البيئة وبادئة المسار فقط. تُنشر بربط المستودع بحساب Vercel، ثم تُضاف في
 * Settings ← Environment Variables (النوع Sensitive):
 *   ANTHROPIC_API_KEY · PARALLEL_API_KEY · (اختياري) ACCESS_TOKEN
 *
 * رابط البوّابة لملف assets/site-config.js:
 *   https://<مشروعك>.vercel.app/api/burhan
 */
import { handle } from "../../gateway/burhan-gateway.js";

export const config = { runtime: "edge" };

export default function handler(request) {
  const env = typeof process !== "undefined" ? process.env : {};
  return handle(request, env, "/api/burhan");
}
