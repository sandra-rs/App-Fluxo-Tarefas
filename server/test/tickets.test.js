import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { criarApp } from "../src/app.js";
import { tituloDaMensagem } from "../src/tickets.js";

let base, servidor;
const chamar = async (metodo, caminho, corpo) => {
  const r = await fetch(base + caminho, { method: metodo, headers: { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { status: r.status, dados: r.status === 204 ? null : await r.json() };
};

before(async () => {
  ({ servidor } = criarApp());
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

test("ticket de exemplo existe e vem com a conversa", async () => {
  const r = await chamar("GET", "/api/tickets");
  assert.equal(r.status, 200);
  const exemplo = r.dados.tickets.find((t) => t.id === "ticket-exemplo");
  assert.ok(exemplo);
  assert.equal(exemplo.lastMessage.author, "agent");
  const d = await chamar("GET", "/api/tickets/ticket-exemplo");
  assert.deepEqual(d.dados.messages.map((m) => m.author), ["user", "agent"]);
});

test("abrir ticket cria a conversa com a primeira mensagem e título derivado", async () => {
  const r = await chamar("POST", "/api/tickets", { content: "  Não consigo mover cartões\nAparece um erro ao soltar.  " });
  assert.equal(r.status, 201);
  assert.equal(r.dados.ticket.title, "Não consigo mover cartões");
  assert.equal(r.dados.ticket.status, "open");
  assert.equal(r.dados.messages.length, 1);
  assert.equal(r.dados.messages[0].author, "user");
  const lista = await chamar("GET", "/api/tickets");
  assert.equal(lista.dados.tickets[0].id, r.dados.ticket.id, "o mais recente vem primeiro");
  assert.equal((await chamar("POST", "/api/tickets", { content: "   " })).status, 400);
});

test("resposta de agente põe em atendimento; mensagem do usuário reabre resolvido", async () => {
  const { ticket } = (await chamar("POST", "/api/tickets", { content: "Ajuda com listas" })).dados;
  const resp = await chamar("POST", `/api/tickets/${ticket.id}/messages`, { author: "agent", authorName: "Agente", content: "Claro, posso ajudar." });
  assert.equal(resp.status, 201);
  assert.equal(resp.dados.message.authorName, "Agente");
  assert.equal(resp.dados.ticket.status, "in_progress");

  assert.equal((await chamar("PATCH", `/api/tickets/${ticket.id}`, { status: "resolved" })).dados.ticket.status, "resolved");
  const reaberto = await chamar("POST", `/api/tickets/${ticket.id}/messages`, { content: "Voltou a acontecer." });
  assert.equal(reaberto.dados.ticket.status, "open");

  assert.equal((await chamar("POST", `/api/tickets/${ticket.id}/messages`, { author: "robo", content: "x" })).status, 400);
  assert.equal((await chamar("PATCH", `/api/tickets/${ticket.id}`, { status: "fechado" })).status, 400);
  const d = await chamar("GET", `/api/tickets/${ticket.id}`);
  assert.equal(d.dados.messages.length, 3);
});

test("excluir ticket apaga a conversa", async () => {
  const { ticket } = (await chamar("POST", "/api/tickets", { content: "Excluir depois" })).dados;
  assert.equal((await chamar("DELETE", `/api/tickets/${ticket.id}`)).status, 200);
  assert.equal((await chamar("GET", `/api/tickets/${ticket.id}`)).status, 404);
  assert.equal((await chamar("POST", `/api/tickets/${ticket.id}/messages`, { content: "oi" })).status, 404);
});

test("título derivado corta linhas longas", () => {
  assert.equal(tituloDaMensagem("\n\n  Olá  \nmais"), "Olá");
  const longo = tituloDaMensagem("a".repeat(200));
  assert.equal(longo.length, 80);
  assert.ok(longo.endsWith("…"));
});
