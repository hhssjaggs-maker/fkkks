// ==========================================================
//  Supabase Edge Function: ai-proxy
//  ให้เว็บเรียก AI ด้วย API key ของ "เซิร์ฟเวอร์" (ผู้ใช้ไม่เห็น key)
//  เฉพาะสมาชิก (ผ่านคีย์ + ล็อกอิน Discord) เท่านั้นที่ใช้ได้
//
//  Deploy:  supabase functions deploy ai-proxy
//  Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//           (หรือ OPENAI_API_KEY / OPENAI_BASE_URL / GEMINI_API_KEY)
//           ALLOWED_MODELS=claude-sonnet-4-5,gemini-2.5-flash   (ไม่บังคับ — จำกัดโมเดล)
// ==========================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1) ตรวจ JWT + สมาชิก
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const { data: isMember } = await sb.rpc("is_member");
  if (!isMember) return json({ error: "not_a_member" }, 403);

  // 2) อ่านคำขอ  { provider, model, body }
  let p: { provider: string; model: string; body: Record<string, unknown> };
  try { p = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const allowed = (Deno.env.get("ALLOWED_MODELS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const baseModel = String(p.model ?? "").replace(/:online$/, "");
  if (allowed.length && !allowed.includes(baseModel)) return json({ error: "model_not_allowed" }, 403);

  // 3) ส่งต่อไปยังผู้ให้บริการด้วย key ฝั่งเซิร์ฟเวอร์
  let url = "", headers: Record<string, string> = { "Content-Type": "application/json" };
  const body = { ...p.body };

  if (p.provider === "anthropic") {
    const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return json({ error: "server_key_missing" }, 500);
    url = (Deno.env.get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com") + "/v1/messages";
    headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01";
  } else if (p.provider === "gemini") {
    const key = Deno.env.get("GEMINI_API_KEY"); if (!key) return json({ error: "server_key_missing" }, 500);
    const base = Deno.env.get("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com";
    url = `${base}/v1beta/models/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse`;
    headers["x-goog-api-key"] = key;
  } else if (p.provider === "openai") {
    const key = Deno.env.get("OPENAI_API_KEY"); if (!key) return json({ error: "server_key_missing" }, 500);
    url = (Deno.env.get("OPENAI_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/$/, "") + "/chat/completions";
    headers["Authorization"] = "Bearer " + key;
  } else return json({ error: "unknown_provider" }, 400);

  const up = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return new Response(up.body, {
    status: up.status,
    headers: { ...cors, "Content-Type": up.headers.get("Content-Type") ?? "text/event-stream", "Cache-Control": "no-cache" },
  });
});
