import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Registration = {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  is_minister: boolean;
  church: string;
  guest_count: number;
  guest_details: string | null;
  deposit_amount: number | string;
  receipt_path: string;
};

function euro(value: number | string) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value));
}

function safeText(value: unknown) {
  return String(value ?? "—").replace(/[\u0000-\u001F\u007F]/g, " ").trim() || "—";
}

function wrapText(text: string, font: any, size: number, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["—"];
}

async function buildPdf(reg: Registration) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.10, 0.13, 0.19);
  const muted = rgb(0.40, 0.44, 0.52);
  const red = rgb(0.75, 0.10, 0.10);
  const border = rgb(0.88, 0.89, 0.92);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 52;
  const contentWidth = pageWidth - margin * 2;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const drawLabelValue = (label: string, value: string, multiline = false) => {
    const labelSize = 9;
    const valueSize = 11;
    const labelWidth = 145;
    const xValue = margin + labelWidth;
    const maxValueWidth = contentWidth - labelWidth;
    const lines = multiline ? wrapText(value, font, valueSize, maxValueWidth) : [value];
    const height = Math.max(28, lines.length * 15 + 8);
    ensureSpace(height + 6);
    page.drawText(label.toUpperCase(), { x: margin, y, size: labelSize, font: bold, color: muted });
    lines.forEach((line, i) => {
      page.drawText(line, { x: xValue, y: y - i * 15, size: valueSize, font, color: dark });
    });
    y -= height;
    page.drawLine({ start: { x: margin, y: y + 6 }, end: { x: pageWidth - margin, y: y + 6 }, thickness: 0.6, color: border });
  };

  page.drawText("WINTER CAMP", { x: margin, y, size: 10, font: bold, color: muted });
  y -= 28;
  page.drawText("Riepilogo prenotazione", { x: margin, y, size: 26, font: bold, color: dark });
  y -= 22;
  page.drawText("Conferma automatica della prenotazione ricevuta.", { x: margin, y, size: 10.5, font, color: muted });
  y -= 32;

  page.drawRectangle({ x: margin, y: y - 58, width: contentWidth, height: 58, borderColor: border, borderWidth: 1, color: rgb(0.98, 0.98, 0.97) });
  page.drawText("CODICE PRENOTAZIONE", { x: margin + 16, y: y - 19, size: 8.5, font: bold, color: muted });
  page.drawText(reg.id.toUpperCase(), { x: margin + 16, y: y - 39, size: 10.5, font: bold, color: dark });
  y -= 84;

  const created = new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(reg.created_at));
  drawLabelValue("Data prenotazione", created);
  drawLabelValue("Nome", safeText(reg.first_name));
  drawLabelValue("Cognome", safeText(reg.last_name));
  drawLabelValue("Email", safeText(reg.email));
  drawLabelValue("Cellulare", safeText(reg.phone));
  drawLabelValue("Ministro", reg.is_minister ? "Sì" : "No");
  drawLabelValue("Chiesa", safeText(reg.church), true);
  drawLabelValue("Numero ospiti", String(reg.guest_count));
  drawLabelValue("Persone totali", String(Number(reg.guest_count) + 1));
  drawLabelValue("Dati ospiti", reg.guest_count > 0 ? safeText(reg.guest_details) : "Nessun ospite", true);
  drawLabelValue("Acconto versato", euro(reg.deposit_amount));
  drawLabelValue("Distinta bonifico", "Allegata alla prenotazione");

  ensureSpace(150);
  y -= 12;
  page.drawText("DATI DEL BONIFICO", { x: margin, y, size: 9, font: bold, color: muted });
  y -= 24;
  page.drawText("IBAN", { x: margin, y, size: 9, font: bold, color: dark });
  page.drawText("IT05U0760116600001051361457", { x: margin + 95, y, size: 10.5, font, color: dark });
  y -= 20;
  page.drawText("INTESTATO A", { x: margin, y, size: 9, font: bold, color: dark });
  page.drawText("Chiesa Evangelica Pentecostale Elim", { x: margin + 95, y, size: 10.5, font, color: dark });
  y -= 20;
  page.drawText("CAUSALE", { x: margin, y, size: 9, font: bold, color: dark });
  const cause = `Acconto Prenotazione Winter Camp “${safeText(reg.last_name)} Famiglia”`;
  const causeLines = wrapText(cause, font, 10.5, contentWidth - 95);
  causeLines.forEach((line, i) => page.drawText(line, { x: margin + 95, y: y - i * 15, size: 10.5, font, color: dark }));
  y -= Math.max(35, causeLines.length * 15 + 12);

  ensureSpace(70);
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.8, color: border });
  y -= 20;
  page.drawText("Conserva questo PDF come ricevuta della prenotazione.", { x: margin, y, size: 9.5, font: bold, color: dark });
  y -= 16;
  page.drawText("La prenotazione resta soggetta alle verifiche organizzative e del pagamento.", { x: margin, y, size: 9, font, color: muted });

  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawText(`Winter Camp · Pagina ${index + 1}/${pages.length}`, { x: margin, y: 24, size: 8, font, color: muted });
  });

  return await pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!authHeader || !anonKey || authHeader !== `Bearer ${anonKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { registration_id } = await req.json();
    if (!registration_id || typeof registration_id !== "string") {
      return new Response(JSON.stringify({ error: "registration_id mancante" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const emailFrom = Deno.env.get("EMAIL_FROM") || "Winter Camp <prenotazioni@example.com>";
    const replyTo = Deno.env.get("REPLY_TO_EMAIL") || undefined;

    if (!resendApiKey) throw new Error("RESEND_API_KEY non configurata");

    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const { data: reg, error: readError } = await admin
      .from("registrations")
      .select("id,created_at,first_name,last_name,email,phone,is_minister,church,guest_count,guest_details,deposit_amount,receipt_path,confirmation_email_sent_at")
      .eq("id", registration_id)
      .single();

    if (readError || !reg) throw readError ?? new Error("Prenotazione non trovata");

    if (reg.confirmation_email_sent_at) {
      return new Response(JSON.stringify({ ok: true, already_sent: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const pdfBytes = await buildPdf(reg as Registration);
    const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));
    const totalPeople = Number(reg.guest_count) + 1;
    const subject = `Winter Camp — Conferma prenotazione ${reg.first_name} ${reg.last_name}`;

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:auto;color:#1d2433;line-height:1.6">
        <p style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#667085">WINTER CAMP</p>
        <h1 style="font-size:28px;line-height:1.15;margin:8px 0 18px">Prenotazione ricevuta</h1>
        <p>Ciao <strong>${safeText(reg.first_name)}</strong>, abbiamo ricevuto correttamente la tua prenotazione.</p>
        <p>In allegato trovi il <strong>PDF riepilogativo</strong> con tutte le informazioni inserite.</p>
        <div style="margin:24px 0;padding:18px;border:1px solid #e7e9ee;border-radius:12px;background:#fafafa">
          <div><strong>Codice prenotazione:</strong> ${reg.id}</div>
          <div><strong>Persone totali:</strong> ${totalPeople}</div>
          <div><strong>Acconto:</strong> ${euro(reg.deposit_amount)}</div>
        </div>
        <p>Conserva questa email e il PDF allegato come riepilogo della prenotazione.</p>
        <p style="font-size:12px;color:#667085;margin-top:28px">Messaggio automatico generato dal modulo Winter Camp.</p>
      </div>`;

    const emailPayload: Record<string, unknown> = {
      from: emailFrom,
      to: [reg.email],
      subject,
      html,
      attachments: [{ filename: `Winter-Camp-Prenotazione-${reg.last_name}.pdf`, content: pdfBase64 }],
    };
    if (replyTo) emailPayload.reply_to = replyTo;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    const resendData = await resendResponse.json();
    if (!resendResponse.ok) throw new Error(`Resend: ${JSON.stringify(resendData)}`);

    await admin.from("registrations").update({ confirmation_email_sent_at: new Date().toISOString() }).eq("id", reg.id);

    return new Response(JSON.stringify({ ok: true, email_id: resendData.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Errore sconosciuto" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
