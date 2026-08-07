/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : supportService.ts
 * Created at  : 2026-08-07
 * Updated at  : 2026-08-07
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/

// The maestro feedback intake: staff send technical requests (алдаа / санал /
// асуулт) from the app straight into maestro's per-project inbox (Төсөл →
// Хүсэлт). The key is minted per project in the maestro UI; it both
// authorises and identifies the caller, and it stays server-side — browsers
// go through the sendSupportRequest mutation. An on-premise install needs
// outbound internet to the maestro host for this to work; without the key the
// mutation fails with a clear message and nothing else is affected.

const URL = process.env.MAESTRO_FEEDBACK_URL
  ?? "https://maestro.longbinarycity.com/api/feedback";

const KEY = process.env.MAESTRO_FEEDBACK_KEY ?? "";

// Screenshots ride along as base64, so give the post more patience than a
// plain JSON call would need.
const TIMEOUT_MS = Number(process.env.MAESTRO_FEEDBACK_TIMEOUT_MS ?? 60_000);

export interface MaestroFeedbackPost {
  text     : string;
  author?  : string;
  contact? : string;
  meta?    : Record<string, string>;
  images?  : {data: string}[];
}

export const feedbackConfigured = () => Boolean(KEY);

/** Files one post into maestro's feedback inbox for the forensic project. */
export const sendMaestroFeedback = async (
  post: MaestroFeedbackPost,
): Promise<void> => {
  if (!KEY) {
    throw new Error(
      "Хүсэлт хүлээн авах тохиргоо дутуу байна (MAESTRO_FEEDBACK_KEY алга).",
    );
  }

  let res: Response;
  try {
    res = await fetch(URL, {
      method  : "POST",
      headers : {
        "content-type" : "application/json",
        "x-api-key"    : KEY,
      },
      body   : JSON.stringify(post),
      signal : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // A timeout or a dead host, told apart from a refusal BY the service.
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Maestro-той холбогдож чадсангүй: ${reason}`);
  }

  if (!res.ok) {
    console.error("maestro feedback failed:", res.status, await res.text());
    throw new Error("Хүсэлт илгээж чадсангүй. Дараа дахин оролдоно уу.");
  }
};
