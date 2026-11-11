import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { agruparPorData, aguardandoAgente, horario, rotuloStatus, STATUS } from "./atendimento.js";
import { Botao } from "./componentes/Botao.jsx";
import { Confirmar } from "./componentes/Confirmar.jsx";
import { Icone } from "./componentes/Icone.jsx";

const INTERVALO_ATUALIZACAO = 5000;

const SUGESTOES = [
  "Não consigo mover um cartão entre listas",
  "Como organizo vários projetos em quadros?",
  "Quero sugerir uma melhoria para o Fluxo",
];

/** Caixa de mensagem: cresce com o texto, Enter envia e Shift+Enter quebra a linha. */
function Compositor({ aoEnviar, ocupado, placeholder, autoFocus, valorInicial }) {
  const [texto, setTexto] = useState("");
  const campo = useRef(null);

  useEffect(() => {
    if (valorInicial) setTexto(valorInicial.texto);
  }, [valorInicial]);

  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [texto]);

  const enviar = async () => {
    const conteudo = texto.trim();
    if (!conteudo || ocupado) return;
    setTexto("");
    const ok = await aoEnviar(conteudo);
    if (!ok) setTexto(conteudo);
    campo.current?.focus();
  };

  return (
    <form className="compositor" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      <textarea
        ref={campo}
        className="compositor-campo"
        rows={1}
        value={texto}
        maxLength={10000}
        placeholder={placeholder}
        aria-label="Mensagem"
        autoFocus={autoFocus}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void enviar();
          }
        }}
      />
      <button type="submit" className="compositor-enviar" aria-label="Enviar mensagem" disabled={!texto.trim() || ocupado}>
        <Icone nome="enviar" tamanho={18} />
      </button>
    </form>
  );
}

function Mensagem({ mensagem }) {
  if (mensagem.author === "user") {
    return (
      <div className="msg msg-usuario" data-pendente={mensagem.pendente ? "" : undefined}>
        <div className="msg-balao">{mensagem.content}</div>
        <span className="msg-hora">{mensagem.pendente ? "Enviando…" : horario(mensagem.createdAt)}</span>
      </div>
    );
  }
  return (
    <div className="msg msg-agente">
      <span className="msg-avatar" aria-hidden="true"><Icone nome="suporte" tamanho={16} /></span>
      <div className="msg-corpo">
        <span className="msg-autor">
          {mensagem.authorName || "Suporte"}
          <span className="msg-hora">{horario(mensagem.createdAt)}</span>
        </span>
        <div className="msg-texto">{mensagem.content}</div>
      </div>
    </div>
  );
}

function SeloStatus({ status }) {
  return <span className="selo-status" data-tom={STATUS[status]?.tom}>{rotuloStatus(status)}</span>;
}

/** Atendimento no formato de chat: histórico de tickets à esquerda, conversa aberta à direita. */
export function TelaAtendimento() {
  const [tickets, setTickets] = useState(null);
  const [selecionado, setSelecionado] = useState(null); // null = novo ticket
  const [conversa, setConversa] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [painel, setPainel] = useState("lista"); // só no celular: "lista" ou "chat"
  const [excluir, setExcluir] = useState(null);
  const [sugestao, setSugestao] = useState(null);
  const rolagem = useRef(null);
  const pedidoAtual = useRef(0);

  const carregarLista = useCallback(async () => {
    const dados = await api.tickets.listar();
    setTickets(dados?.tickets ?? []);
  }, []);

  useEffect(() => {
    carregarLista().catch((e) => { setErro(e.message); setTickets([]); });
  }, [carregarLista]);

  const abrirTicket = async (id) => {
    const pedido = ++pedidoAtual.current;
    setSelecionado(id);
    setPainel("chat");
    setErro(null);
    if (id === null) { setConversa(null); return; }
    setCarregando(true);
    try {
      const dados = await api.tickets.detalhe(id);
      if (pedido === pedidoAtual.current) setConversa(dados);
    } catch (e) {
      if (pedido === pedidoAtual.current) setErro(e.message);
    } finally {
      if (pedido === pedidoAtual.current) setCarregando(false);
    }
  };

  // Respostas de agentes chegam pela API: atualiza a lista e a conversa aberta de tempos em tempos.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden || enviando) return;
      carregarLista().catch(() => {});
      if (selecionado) {
        const pedido = pedidoAtual.current;
        api.tickets.detalhe(selecionado)
          .then((dados) => { if (pedido === pedidoAtual.current) setConversa(dados); })
          .catch(() => {});
      }
    }, INTERVALO_ATUALIZACAO);
    return () => clearInterval(id);
  }, [selecionado, enviando, carregarLista]);

  const qtdMensagens = conversa?.messages?.length ?? 0;
  useEffect(() => {
    const el = rolagem.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [qtdMensagens, selecionado]);

  const enviar = async (conteudo) => {
    setErro(null);
    setEnviando(true);
    const temporaria = { id: `temp-${Date.now()}`, author: "user", content: conteudo, createdAt: new Date().toISOString(), pendente: true };
    try {
      if (selecionado === null) {
        setConversa({ ticket: null, messages: [temporaria] });
        const dados = await api.tickets.abrir(conteudo);
        pedidoAtual.current++;
        setSelecionado(dados.ticket.id);
        setConversa(dados);
      } else {
        setConversa((c) => ({ ...c, messages: [...c.messages, temporaria] }));
        const dados = await api.tickets.enviar(selecionado, conteudo);
        setConversa((c) => ({ ticket: dados.ticket, messages: [...c.messages.filter((m) => m.id !== temporaria.id), dados.message] }));
      }
      await carregarLista().catch(() => {});
      return true;
    } catch (e) {
      setErro(e.message);
      setConversa((c) => {
        if (!c) return c;
        const resto = c.messages.filter((m) => m.id !== temporaria.id);
        return c.ticket ? { ...c, messages: resto } : null;
      });
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const mudarStatus = async (status) => {
    try {
      const { ticket } = await api.tickets.mudarStatus(selecionado, status);
      setConversa((c) => ({ ...c, ticket }));
      await carregarLista();
    } catch (e) { setErro(e.message); }
  };

  const confirmarExclusao = async () => {
    const alvo = excluir;
    setExcluir(null);
    try {
      await api.tickets.excluir(alvo.id);
      if (alvo.id === selecionado) { pedidoAtual.current++; setSelecionado(null); setConversa(null); setPainel("lista"); }
      await carregarLista();
    } catch (e) { setErro(e.message); }
  };

  const ticket = conversa?.ticket;
  const mensagens = conversa?.messages ?? [];
  const novo = selecionado === null && mensagens.length === 0;
  const grupos = tickets ? agruparPorData(tickets) : [];

  return (
    <div className="atendimento" data-painel={painel}>
      <nav className="conversas" aria-label="Tickets de atendimento">
        <div className="conversas-topo">
          <h1 className="conversas-titulo">Atendimento</h1>
        </div>
        <button type="button" className="conversas-novo" aria-current={selecionado === null ? "page" : undefined} onClick={() => void abrirTicket(null)}>
          <Icone nome="lapis" tamanho={16} />
          Novo ticket
        </button>

        {tickets === null ? (
          <p className="conversas-vazio">Carregando tickets…</p>
        ) : grupos.length === 0 ? (
          <p className="conversas-vazio">Nenhum ticket ainda. Conte o que aconteceu e abrimos o primeiro.</p>
        ) : (
          grupos.map((g) => (
            <section key={g.titulo} className="conversas-grupo">
              <h2 className="conversas-grupo-titulo">{g.titulo}</h2>
              <ul>
                {g.tickets.map((t) => (
                  <li key={t.id} className="conversas-item" data-ativo={t.id === selecionado ? "" : undefined}>
                    <button
                      type="button"
                      className="conversas-escolha"
                      aria-current={t.id === selecionado ? "page" : undefined}
                      onClick={() => void abrirTicket(t.id)}
                      title={t.title}
                    >
                      <span className="conversas-ponto" data-tom={STATUS[t.status]?.tom} aria-hidden="true" />
                      <span className="conversas-nome">{t.title}</span>
                      <span className="visualmente-oculto">, {rotuloStatus(t.status)}</span>
                    </button>
                    <Botao variante="fantasma" icone="lixeira" className="conversas-excluir" aria-label={`Excluir ticket ${t.title}`} onClick={() => setExcluir(t)} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>

      <section className="chat" aria-label={ticket ? `Conversa: ${ticket.title}` : "Novo ticket"}>
        <header className="chat-topo">
          <Botao variante="fantasma" icone="chevron-esquerda" className="chat-voltar" aria-label="Voltar para os tickets" onClick={() => setPainel("lista")} />
          {ticket ? (
            <>
              <div className="chat-titulo-bloco">
                <h2 className="chat-titulo">{ticket.title}</h2>
                <SeloStatus status={ticket.status} />
              </div>
              <div className="chat-acoes">
                {ticket.status === "resolved" ? (
                  <Botao variante="fantasma" icone="atualizar" onClick={() => void mudarStatus("open")}>Reabrir</Botao>
                ) : (
                  <Botao variante="fantasma" icone="check" onClick={() => void mudarStatus("resolved")}>Marcar como resolvido</Botao>
                )}
              </div>
            </>
          ) : (
            <h2 className="chat-titulo">{selecionado === null ? "Novo ticket" : ""}</h2>
          )}
        </header>

        {erro ? (
          <div className="aviso chat-aviso" role="alert">
            <span className="aviso-texto"><Icone nome="alerta" tamanho={18} /><span>{erro}</span></span>
            <Botao variante="fantasma" icone="fechar" aria-label="Fechar aviso" onClick={() => setErro(null)} />
          </div>
        ) : null}

        {novo ? (
          <div className="chat-inicio">
            <span className="chat-inicio-icone" aria-hidden="true"><Icone nome="suporte" tamanho={28} /></span>
            <h2>Como podemos ajudar?</h2>
            <p>Descreva o problema ou a dúvida. Cada ticket vira uma conversa, e o suporte responde aqui mesmo.</p>
            <div className="chat-coluna">
              <Compositor aoEnviar={enviar} ocupado={enviando} placeholder="Descreva o que aconteceu…" autoFocus valorInicial={sugestao} />
              <div className="chat-sugestoes">
                {SUGESTOES.map((s) => (
                  <button key={s} type="button" className="chat-sugestao" onClick={() => setSugestao({ texto: s })}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="chat-mensagens" ref={rolagem} aria-live="polite" aria-busy={carregando}>
              <div className="chat-coluna">
                {carregando && !mensagens.length ? (
                  <p className="carregando-line" role="status">Carregando conversa…</p>
                ) : (
                  mensagens.map((m) => <Mensagem key={m.id} mensagem={m} />)
                )}
                {aguardandoAgente(ticket, mensagens) && !enviando ? (
                  <div className="msg msg-agente msg-espera">
                    <span className="msg-avatar" aria-hidden="true"><Icone nome="suporte" tamanho={16} /></span>
                    <div className="msg-corpo">
                      <span className="digitando" aria-hidden="true"><span /><span /><span /></span>
                      <span className="msg-nota">Recebemos sua mensagem. Um agente vai responder nesta conversa.</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="chat-rodape">
              <div className="chat-coluna">
                <Compositor
                  aoEnviar={enviar}
                  ocupado={enviando}
                  placeholder={ticket?.status === "resolved" ? "Escreva para reabrir este ticket…" : "Escreva uma mensagem…"}
                />
                <p className="chat-legenda">Enter envia · Shift+Enter quebra a linha</p>
              </div>
            </div>
          </>
        )}
      </section>

      {excluir ? (
        <Confirmar
          aberto
          titulo="Excluir ticket"
          descricao={`Excluir "${excluir.title}" apaga a conversa inteira. Não dá para desfazer.`}
          rotuloConfirmar="Excluir ticket"
          aoConfirmar={() => void confirmarExclusao()}
          aoFechar={() => setExcluir(null)}
        />
      ) : null}
    </div>
  );
}
