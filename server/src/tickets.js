// Atendimento: tickets de suporte em formato de conversa. Contrato JSON em inglês, sem exigir login.
// Agentes autônomos respondem com POST /api/tickets/:id/messages e { author: "agent", authorName, content }.
import { randomUUID } from "node:crypto";
import { invalido, naoEncontrado, texto } from "./http.js";
import { transacao } from "./db.js";

const STATUS = ["open", "in_progress", "resolved"];
const AUTORES = ["user", "agent"];

/** Título do ticket a partir da primeira mensagem: primeira linha, até 80 caracteres. */
export function tituloDaMensagem(conteudo) {
  const linha = conteudo.split("\n").map((l) => l.trim()).find(Boolean) ?? "Novo ticket";
  return linha.length > 80 ? `${linha.slice(0, 79).trimEnd()}…` : linha;
}

const saidaMensagem = (m) => ({
  id: m.id, ticketId: m.ticket_id, author: m.author, authorName: m.author_name, content: m.content, createdAt: m.criado_em,
});

export function rotasDeTickets(app, db) {
  const buscarTicket = (id) => {
    const t = db.prepare("SELECT * FROM ticket WHERE id = ?").get(id);
    if (!t) throw naoEncontrado("Ticket");
    return t;
  };
  const ultimaMensagem = db.prepare("SELECT * FROM ticket_message WHERE ticket_id = ? ORDER BY criado_em DESC, rowid DESC LIMIT 1");
  const saidaTicket = (t) => {
    const ultima = ultimaMensagem.get(t.id);
    return {
      id: t.id, title: t.title, status: t.status, createdAt: t.criado_em, updatedAt: t.atualizado_em,
      lastMessage: ultima ? { author: ultima.author, content: ultima.content.slice(0, 160) } : null,
    };
  };
  const mensagens = (ticketId) =>
    db.prepare("SELECT * FROM ticket_message WHERE ticket_id = ? ORDER BY criado_em, rowid").all(ticketId).map(saidaMensagem);

  const gravarMensagem = (ticketId, { author, authorName, content }, agora) => {
    const m = { id: randomUUID(), ticket_id: ticketId, author, author_name: authorName, content, criado_em: agora };
    db.prepare("INSERT INTO ticket_message (id, ticket_id, author, author_name, content, criado_em) VALUES (?, ?, ?, ?, ?, ?)")
      .run(m.id, m.ticket_id, m.author, m.author_name, m.content, m.criado_em);
    return saidaMensagem(m);
  };

  const lerMensagem = (corpo) => {
    const author = corpo.author ?? "user";
    if (!AUTORES.includes(author)) throw invalido(`author deve ser ${AUTORES.join(" ou ")}.`);
    return {
      author,
      authorName: texto(corpo, "authorName", { min: 0, max: 80, opcional: true }) ?? "",
      content: texto(corpo, "content", { max: 10000 }),
    };
  };

  app.get("/api/tickets", () => ({
    tickets: db.prepare("SELECT * FROM ticket ORDER BY atualizado_em DESC, rowid DESC").all().map(saidaTicket),
  }));

  // Abre um ticket já com a primeira mensagem do usuário, como uma conversa nova.
  app.post("/api/tickets", ({ corpo }) => {
    const content = texto(corpo, "content", { max: 10000 });
    const title = texto(corpo, "title", { max: 120, opcional: true }) ?? tituloDaMensagem(content);
    const agora = new Date().toISOString();
    const id = randomUUID();
    return transacao(db, () => {
      db.prepare("INSERT INTO ticket (id, title, status, criado_em, atualizado_em) VALUES (?, ?, 'open', ?, ?)").run(id, title, agora, agora);
      const message = gravarMensagem(id, { author: "user", authorName: "", content }, agora);
      return { ticket: saidaTicket(buscarTicket(id)), messages: [message] };
    });
  });

  app.get("/api/tickets/:id", ({ params }) => {
    const t = buscarTicket(params.id);
    return { ticket: saidaTicket(t), messages: mensagens(t.id) };
  });

  app.patch("/api/tickets/:id", ({ params, corpo }) => {
    const t = buscarTicket(params.id);
    const title = texto(corpo, "title", { max: 120, opcional: true }) ?? t.title;
    const status = corpo.status ?? t.status;
    if (!STATUS.includes(status)) throw invalido(`status deve ser ${STATUS.join(", ")}.`);
    db.prepare("UPDATE ticket SET title = ?, status = ?, atualizado_em = ? WHERE id = ?").run(title, status, new Date().toISOString(), t.id);
    return { ticket: saidaTicket(buscarTicket(t.id)) };
  });

  app.delete("/api/tickets/:id", ({ params }) => {
    const t = buscarTicket(params.id);
    db.prepare("DELETE FROM ticket WHERE id = ?").run(t.id); // mensagens caem em cascata
    return { ok: true };
  });

  // Resposta de agente coloca o ticket em atendimento; nova mensagem do usuário reabre um ticket resolvido.
  app.post("/api/tickets/:id/messages", ({ params, corpo }) => {
    const t = buscarTicket(params.id);
    const dados = lerMensagem(corpo);
    const agora = new Date().toISOString();
    const status = dados.author === "agent" ? (t.status === "resolved" ? "resolved" : "in_progress")
      : t.status === "resolved" ? "open" : t.status;
    return transacao(db, () => {
      const message = gravarMensagem(t.id, dados, agora);
      db.prepare("UPDATE ticket SET status = ?, atualizado_em = ? WHERE id = ?").run(status, agora, t.id);
      return { message, ticket: saidaTicket(buscarTicket(t.id)) };
    });
  });
}
