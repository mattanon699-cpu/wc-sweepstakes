import { useState, useEffect, useCallback } from "react";
import { PARTICIPANTS } from "./participants.js";

const POT_COLORS = { a: "#ef4444", b: "#f97316", c: "#eab308", d: "#22c55e" };
const POT_LABELS = { a: "POT A", b: "POT B", c: "POT C", d: "POT D" };

const TEAM_NAME_MAP = {
  "Bosnia-Herz.":  ["Bosnia Herzegovina", "Bosnia & Herzegovina", "Bosnia-Herzegovina"],
  "Côte d'Ivoire": ["Ivory Coast", "Côte d'Ivoire"],
  "Curaçao":       ["Curacao", "Curaçao"],
  "South Korea":   ["Korea Republic", "South Korea"],
  "DR Congo":      ["Congo DR", "DR Congo", "Congo, DR"],
  "Türkiye":       ["Turkey", "Türkiye"],
  "USA":           ["United States", "USA"],
};

function normalizeTeamName(name) {
  for (const [canonical, aliases] of Object.entries(TEAM_NAME_MAP)) {
    if (aliases.includes(name) || name === canonical) return canonical;
  }
  return name;
}

const KNOCKOUT_BONUS = { LAST_16: 2, QUARTER_FINALS: 3, SEMI_FINALS: 4, FINAL: 5 };

function calcPoints(teamName, matches, isPotD = false) {
  let pts = 0;
  const norm = normalizeTeamName(teamName);
  for (const m of matches) {
    if (!m.score?.fullTime) continue;
    const { home, away } = m.score.fullTime;
    if (home == null || away == null) continue;
    const homeTeam = normalizeTeamName(m.homeTeam?.name || "");
    const awayTeam = normalizeTeamName(m.awayTeam?.name || "");
    const isHome = homeTeam === norm;
    const isAway = awayTeam === norm;
    if (!isHome && !isAway) continue;
    const stage = m.stage || "";
    const isKnockout = !stage.includes("GROUP");
    let matchPts = 0;
    if (isHome) { if (home > away) matchPts += 3; else if (home === away) matchPts += 1; }
    else        { if (away > home) matchPts += 3; else if (home === away) matchPts += 1; }
    if (isPotD && isKnockout && matchPts > 0) matchPts += KNOCKOUT_BONUS[stage] || 0;
    pts += matchPts;
  }
  return pts;
}

function calcAllPoints(participant, matches) {
  return (
    calcPoints(participant.teams.a, matches) +
    calcPoints(participant.teams.b, matches) +
    calcPoints(participant.teams.c, matches) +
    calcPoints(participant.teams.d, matches, true)
  );
}

function getTeamRecord(teamName, matches) {
  const norm = normalizeTeamName(teamName);
  let w = 0, d = 0, l = 0;
  for (const m of matches) {
    if (!m.score?.fullTime) continue;
    const { home, away } = m.score.fullTime;
    if (home == null || away == null) continue;
    const homeTeam = normalizeTeamName(m.homeTeam?.name || "");
    const awayTeam = normalizeTeamName(m.awayTeam?.name || "");
    const isHome = homeTeam === norm;
    const isAway = awayTeam === norm;
    if (!isHome && !isAway) continue;
    if (isHome) { if (home > away) w++; else if (home === away) d++; else l++; }
    else        { if (away > home) w++; else if (home === away) d++; else l++; }
  }
  return { w, d, l };
}

// All participant teams as a flat set for quick lookup
const ALL_TEAMS = new Set(
  PARTICIPANTS.flatMap(p => Object.values(p.teams).map(t => normalizeTeamName(t)))
);

function isParticipantTeam(name) {
  return ALL_TEAMS.has(normalizeTeamName(name));
}

// Find owner(s) of a team across all pots
function getOwners(teamName) {
  const norm = normalizeTeamName(teamName);
  const owners = [];
  for (const p of PARTICIPANTS) {
    for (const [pot, t] of Object.entries(p.teams)) {
      if (normalizeTeamName(t) === norm) owners.push({ name: p.name, slug: p.slug, pot });
    }
  }
  return owners;
}

// Get matches today (UTC date) that involve at least one participant team
function getTodayMatches(matches) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return matches.filter(m => {
    if (!m.utcDate) return false;
    if (m.utcDate.slice(0, 10) !== today) return false;
    const home = normalizeTeamName(m.homeTeam?.name || "");
    const away = normalizeTeamName(m.awayTeam?.name || "");
    return isParticipantTeam(home) || isParticipantTeam(away);
  });
}

// Get live match for a specific team
function getLiveMatch(teamName, matches) {
  const norm = normalizeTeamName(teamName);
  return matches.find(m => {
    if (m.status !== "IN_PLAY") return false;
    const home = normalizeTeamName(m.homeTeam?.name || "");
    const away = normalizeTeamName(m.awayTeam?.name || "");
    return home === norm || away === norm;
  }) || null;
}

// Format UTC date to Irish time
function toIrishTime(utcDate) {
  return new Date(utcDate).toLocaleTimeString("en-IE", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin"
  });
}

function Avatar({ slug, name, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const initials = name.slice(0, 2).toUpperCase();
  if (failed) {
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: "linear-gradient(135deg, #6366f1, #3b82f6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.28, fontWeight: 700, color: "#fff", flexShrink: 0,
      }}>
        {initials}
      </div>
    );
  }
  return (
    <img src={`/avatars/${slug}.jpg`} alt={name} onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid #2a3356" }} />
  );
}

function getPlayerSlug() {
  const params = new URLSearchParams(window.location.search);
  return params.get("player")?.toLowerCase() || null;
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("wc_api_key") || "8b440853fdff4f8faba3002d0c058ea1");
  const [keyInput, setKeyInput]   = useState("");
  const [matches, setMatches]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeTab, setActiveTab] = useState("leaderboard");

  const playerSlug = getPlayerSlug();
  const currentPlayer = PARTICIPANTS.find(p => p.slug === playerSlug) || null;

  const fetchMatches = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/matches");
      if (!res.ok) throw new Error(res.status === 403 ? "Invalid API key" : `API error: ${res.status}`);
      const data = await res.json();
      setMatches(data.matches || []);
      setLastUpdated(new Date());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  // Initial fetch
  useEffect(() => { if (apiKey) fetchMatches(); }, [apiKey, fetchMatches]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!apiKey) return;
    const interval = setInterval(() => fetchMatches(), 60000);
    return () => clearInterval(interval);
  }, [apiKey, fetchMatches]);

  const handleKeySubmit = () => {
    if (!keyInput.trim()) return;
    localStorage.setItem("wc_api_key", keyInput.trim());
    setApiKey(keyInput.trim());
    setKeyInput("");
  };

  const leaderboard = PARTICIPANTS
    .map(p => ({ ...p, points: calcAllPoints(p, matches) }))
    .sort((a, b) => b.points - a.points);

  const todayMatches = getTodayMatches(matches);
  const anyLive = todayMatches.some(m => m.status === "IN_PLAY");

  if (!apiKey) {
    return (
      <div style={s.root}>
        <div style={s.setupCard}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>⚽</div>
          <h1 style={s.setupTitle}>World Cup 2026</h1>
          <p style={s.setupSubtitle}>Sweepstakes Tracker</p>
          <p style={s.setupHint}>Enter your football-data.org API key to get started</p>
          <input style={s.keyInput} type="text" placeholder="Paste API key here..." value={keyInput}
            onChange={e => setKeyInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleKeySubmit()} />
          <button style={s.submitBtn} onClick={handleKeySubmit}>Let's go →</button>
          <p style={s.keyHint}>Get a free key at{" "}
            <a href="https://www.football-data.org" target="_blank" rel="noreferrer" style={s.link}>football-data.org</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.root}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div>
            <div style={s.eyebrow}>FIFA WORLD CUP 2026</div>
            <h1 style={s.headerTitle}>Sweepstakes</h1>
          </div>
          <button style={s.refreshBtn} onClick={() => fetchMatches()} disabled={loading}>
            ↻ {loading ? "Updating..." : "Refresh"}
          </button>
        </div>
        {lastUpdated && (
          <div style={s.lastUpdated}>
            Updated {lastUpdated.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
        {error && <div style={s.errorBanner}>⚠️ {error}</div>}
      </header>

      <div style={s.tabs}>
        {[
          { id: "leaderboard", label: "🏆 Leaderboard" },
          { id: "myteams",     label: currentPlayer ? `⚽ ${currentPlayer.name}` : "👥 Teams" },
          { id: "fixtures",    label: "📅 Fixtures" },
        ].map(tab => (
          <button key={tab.id}
            style={{ ...s.tab, ...(activeTab === tab.id ? s.tabActive : {}) }}
            onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      <main style={s.main}>

        {/* TODAY'S MATCHES BANNER — shown on leaderboard tab only */}
        {activeTab === "leaderboard" && todayMatches.length > 0 && (
          <div style={s.todayBanner}>
            <div style={s.todayHeader}>
              {anyLive
                ? <><span style={s.liveDot} />LIVE NOW</>
                : "TODAY'S MATCHES"
              }
            </div>
            {todayMatches.map(m => {
              const isLive = m.status === "IN_PLAY";
              const isFinished = m.status === "FINISHED";
              const homeScore = m.score?.fullTime?.home;
              const awayScore = m.score?.fullTime?.away;
              const homeNorm = normalizeTeamName(m.homeTeam?.name || "");
              const awayNorm = normalizeTeamName(m.awayTeam?.name || "");
              const homeOwners = getOwners(homeNorm);
              const awayOwners = getOwners(awayNorm);
              return (
                <div key={m.id} style={{ ...s.todayMatch, ...(isLive ? s.todayMatchLive : {}) }}>
                  <div style={s.todayMatchTeams}>
                    <div style={s.todayTeam}>
                      <span style={s.todayTeamName}>{m.homeTeam?.shortName || m.homeTeam?.name}</span>
                      {homeOwners.map(o => (
                        <span key={o.slug} style={{ ...s.ownerPill, background: POT_COLORS[o.pot] + "33", color: POT_COLORS[o.pot] }}>{o.name}</span>
                      ))}
                    </div>
                    <div style={s.todayScore}>
                      {isLive || isFinished
                        ? <span style={{ ...s.scoreText, ...(isLive ? { color: "#ef4444" } : {}) }}>{homeScore ?? 0} – {awayScore ?? 0}</span>
                        : <span style={s.kickoff}>{toIrishTime(m.utcDate)}</span>
                      }
                    </div>
                    <div style={{ ...s.todayTeam, alignItems: "flex-end" }}>
                      <span style={s.todayTeamName}>{m.awayTeam?.shortName || m.awayTeam?.name}</span>
                      {awayOwners.map(o => (
                        <span key={o.slug} style={{ ...s.ownerPill, background: POT_COLORS[o.pot] + "33", color: POT_COLORS[o.pot] }}>{o.name}</span>
                      ))}
                    </div>
                  </div>
                  {isLive && <div style={s.liveTag}>LIVE</div>}
                  {isFinished && <div style={s.finishedTag}>FT</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* LEADERBOARD */}
        {activeTab === "leaderboard" && (
          <div>
            <div style={s.sectionLabel}>GAME 2 — POINTS STANDINGS</div>
            {leaderboard.map((p, i) => {
              const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
              const isMe = currentPlayer?.slug === p.slug;
              // Check if any of this person's teams are live
              const liveTeam = Object.values(p.teams).find(t => getLiveMatch(t, matches));
              const liveMatch = liveTeam ? getLiveMatch(liveTeam, matches) : null;
              return (
                <div key={p.name} style={{ ...s.leaderRow, ...(i === 0 ? s.leaderRowFirst : {}), ...(isMe ? s.leaderRowMe : {}), ...(liveMatch ? s.leaderRowLive : {}) }}>
                  <div style={s.leaderLeft}>
                    <div style={{ ...s.rank, ...(i === 0 ? s.rankFirst : {}) }}>{medal || i + 1}</div>
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <Avatar slug={p.slug} name={p.name} size={48} />
                      {liveMatch && <span style={s.livePulse} />}
                    </div>
                    <div>
                      <div style={s.participantName}>
                        {p.name} {isMe && <span style={s.youBadge}>you</span>}
                      </div>
                      <div style={s.teamPills}>
                        {Object.entries(p.teams).map(([pot, team]) => (
                          <span key={pot} style={{ ...s.pill, background: POT_COLORS[pot] + "22", color: POT_COLORS[pot], borderColor: POT_COLORS[pot] + "44" }}>
                            {team}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={s.pointsBadge}>
                    <span style={s.pointsNum}>{p.points}</span>
                    <span style={s.pointsLabel}>pts</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* MY TEAMS */}
        {activeTab === "myteams" && (
          <div>
            {currentPlayer ? (
              <div>
                <div style={s.myTeamsHero}>
                  <Avatar slug={currentPlayer.slug} name={currentPlayer.name} size={72} />
                  <div>
                    <div style={s.myTeamsName}>{currentPlayer.name}</div>
                    <div style={s.myTeamsPoints}>{calcAllPoints(currentPlayer, matches)} points</div>
                    <div style={s.myTeamsRank}>
                      #{leaderboard.findIndex(p => p.slug === currentPlayer.slug) + 1} of {PARTICIPANTS.length}
                    </div>
                  </div>
                </div>
                <div style={s.sectionLabel}>YOUR TEAMS</div>
                {Object.entries(currentPlayer.teams).map(([pot, team]) => {
                  const rec = getTeamRecord(team, matches);
                  const pts = calcPoints(team, matches, pot === "d");
                  const live = getLiveMatch(team, matches);
                  return (
                    <div key={pot} style={{ ...s.myTeamCard, ...(live ? { borderColor: "#ef4444" } : {}) }}>
                      <div style={s.myTeamCardLeft}>
                        <span style={{ ...s.potTagLarge, background: POT_COLORS[pot] + "22", color: POT_COLORS[pot] }}>
                          {POT_LABELS[pot]}
                        </span>
                        <div>
                          <div style={s.myTeamName}>
                            {team}
                            {live && <span style={s.liveTag}>LIVE</span>}
                          </div>
                          <div style={s.myTeamRecord}>{rec.w}W · {rec.d}D · {rec.l}L</div>
                        </div>
                      </div>
                      <div style={s.myTeamPts}>
                        <span style={s.myTeamPtsNum}>{pts}</span>
                        <span style={s.myTeamPtsLabel}>pts</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>
                <div style={s.sectionLabel}>ALL PARTICIPANTS</div>
                <div style={s.noPlayerHint}>
                  💡 Share personalised links so each person sees their own teams — e.g. <code style={s.code}>?player=eamo</code>
                </div>
                <div style={s.cardsGrid}>
                  {PARTICIPANTS.map(p => (
                    <div key={p.name} style={s.card}>
                      <div style={s.cardHeader}>
                        <Avatar slug={p.slug} name={p.name} size={40} />
                        <div>
                          <div style={s.cardName}>{p.name}</div>
                          <div style={s.cardPts}>{calcAllPoints(p, matches)} pts</div>
                        </div>
                      </div>
                      <div style={s.cardTeams}>
                        {Object.entries(p.teams).map(([pot, team]) => {
                          const rec = getTeamRecord(team, matches);
                          return (
                            <div key={pot} style={s.teamRow}>
                              <span style={{ ...s.potTag, background: POT_COLORS[pot] + "22", color: POT_COLORS[pot] }}>
                                {POT_LABELS[pot]}
                              </span>
                              <span style={s.teamName}>{team}</span>
                              <span style={s.record}>{rec.w}W {rec.d}D {rec.l}L</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* FIXTURES */}
        {activeTab === "fixtures" && (
          <div>
            <div style={s.sectionLabel}>WORLD CUP FIXTURES</div>
            <iframe
              src="https://www.sportbusy.com/embed/world-cup"
              style={{ width: "100%", height: "80vh", border: "none", borderRadius: 12, background: "#111827" }}
              title="World Cup Fixtures"
            />
          </div>
        )}

      </main>

      <footer style={s.footer}>
        <span>€120 pot · 12 players · WC 2026</span>
        <button style={s.resetBtn} onClick={() => { localStorage.removeItem("wc_api_key"); setApiKey(""); }}>
          Reset key
        </button>
      </footer>
    </div>
  );
}

const s = {
  root: { minHeight: "100vh", background: "#0a0f1e", color: "#f0f4ff", fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", maxWidth: 680, margin: "0 auto" },
  setupCard: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem", textAlign: "center" },
  setupTitle: { fontSize: 36, fontWeight: 800, margin: 0, letterSpacing: -1, color: "#fff" },
  setupSubtitle: { fontSize: 16, color: "#6b7a99", marginTop: 6, marginBottom: 32 },
  setupHint: { fontSize: 14, color: "#8892aa", marginBottom: 16 },
  keyInput: { width: "100%", maxWidth: 400, padding: "14px 16px", background: "#141929", border: "1px solid #2a3356", borderRadius: 10, color: "#f0f4ff", fontSize: 15, outline: "none", boxSizing: "border-box" },
  submitBtn: { marginTop: 12, padding: "14px 32px", background: "linear-gradient(135deg,#3b82f6,#6366f1)", border: "none", borderRadius: 10, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", width: "100%", maxWidth: 400 },
  keyHint: { marginTop: 16, fontSize: 12, color: "#6b7a99" },
  link: { color: "#6366f1" },
  header: { padding: "20px 20px 0", borderBottom: "1px solid #1a2040" },
  headerInner: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#6366f1", marginBottom: 4 },
  headerTitle: { fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: -0.5 },
  refreshBtn: { padding: "8px 14px", background: "#141929", border: "1px solid #2a3356", borderRadius: 8, color: "#8892aa", fontSize: 13, cursor: "pointer" },
  lastUpdated: { fontSize: 11, color: "#4a5568", padding: "8px 0 12px" },
  errorBanner: { background: "#2d1515", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#fca5a5", marginBottom: 12 },
  hint: { fontSize: 13, color: "#6b7a99", padding: "20px 0" },
  tabs: { display: "flex", borderBottom: "1px solid #1a2040", padding: "0 20px" },
  tab: { padding: "14px 16px", background: "none", border: "none", color: "#6b7a99", fontSize: 13, fontWeight: 600, cursor: "pointer", borderBottom: "2px solid transparent", marginBottom: -1 },
  tabActive: { color: "#f0f4ff", borderBottomColor: "#6366f1" },
  main: { padding: "20px" },
  sectionLabel: { fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#6b7a99", marginBottom: 16 },
  // Today's matches banner
  todayBanner: { background: "#111827", border: "1px solid #1a2040", borderRadius: 12, padding: "14px", marginBottom: 20 },
  todayHeader: { fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#6b7a99", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 },
  liveDot: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#ef4444" },
  todayMatch: { padding: "10px 0", borderBottom: "1px solid #1a2040" },
  todayMatchLive: { },
  todayMatchTeams: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  todayTeam: { display: "flex", flexDirection: "column", flex: 1 },
  todayTeamName: { fontSize: 13, fontWeight: 700, marginBottom: 3 },
  ownerPill: { fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, display: "inline-block", marginTop: 2, marginRight: 3 },
  todayScore: { textAlign: "center", minWidth: 60 },
  scoreText: { fontSize: 18, fontWeight: 800 },
  kickoff: { fontSize: 13, color: "#6b7a99", fontWeight: 600 },
  liveTag: { fontSize: 9, fontWeight: 800, background: "#ef4444", color: "#fff", padding: "2px 6px", borderRadius: 4, marginLeft: 8, verticalAlign: "middle", letterSpacing: 1 },
  finishedTag: { fontSize: 9, fontWeight: 700, background: "#1a2040", color: "#6b7a99", padding: "2px 6px", borderRadius: 4, marginLeft: 8, verticalAlign: "middle" },
  // Leaderboard
  leaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", marginBottom: 8, background: "#111827", borderRadius: 12, border: "1px solid #1a2040" },
  leaderRowFirst: { background: "linear-gradient(135deg,#1a1f3d,#16213e)", border: "1px solid #3b4fd6" },
  leaderRowMe: { border: "1px solid #6366f1" },
  leaderRowLive: { border: "1px solid #ef444466" },
  leaderLeft: { display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 },
  rank: { width: 28, height: 28, borderRadius: 8, background: "#1a2040", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#6b7a99", flexShrink: 0 },
  rankFirst: { background: "#6366f1", color: "#fff" },
  livePulse: { position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderRadius: "50%", background: "#ef4444", border: "2px solid #0a0f1e" },
  participantName: { fontSize: 15, fontWeight: 700, marginBottom: 4 },
  youBadge: { fontSize: 10, fontWeight: 700, background: "#6366f1", color: "#fff", padding: "1px 6px", borderRadius: 4, marginLeft: 6, verticalAlign: "middle" },
  teamPills: { display: "flex", flexWrap: "wrap", gap: 4 },
  pill: { fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, border: "1px solid" },
  pointsBadge: { display: "flex", flexDirection: "column", alignItems: "center", minWidth: 48, flexShrink: 0 },
  pointsNum: { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  pointsLabel: { fontSize: 10, color: "#6b7a99", marginTop: 2 },
  // My teams
  myTeamsHero: { display: "flex", alignItems: "center", gap: 20, padding: "20px", background: "linear-gradient(135deg,#1a1f3d,#16213e)", borderRadius: 16, border: "1px solid #3b4fd6", marginBottom: 24 },
  myTeamsName: { fontSize: 24, fontWeight: 800, marginBottom: 4 },
  myTeamsPoints: { fontSize: 16, color: "#6366f1", fontWeight: 700 },
  myTeamsRank: { fontSize: 12, color: "#6b7a99", marginTop: 2 },
  myTeamCard: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", marginBottom: 10, background: "#111827", borderRadius: 12, border: "1px solid #1a2040" },
  myTeamCardLeft: { display: "flex", alignItems: "center", gap: 12 },
  potTagLarge: { fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: 6, flexShrink: 0 },
  myTeamName: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  myTeamRecord: { fontSize: 12, color: "#6b7a99" },
  myTeamPts: { display: "flex", flexDirection: "column", alignItems: "center" },
  myTeamPtsNum: { fontSize: 26, fontWeight: 800, lineHeight: 1 },
  myTeamPtsLabel: { fontSize: 10, color: "#6b7a99" },
  // All teams
  noPlayerHint: { background: "#141929", border: "1px solid #2a3356", borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "#8892aa", marginBottom: 16 },
  code: { background: "#1a2040", padding: "2px 6px", borderRadius: 4, fontSize: 12, color: "#6366f1" },
  cardsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 },
  card: { background: "#111827", borderRadius: 12, border: "1px solid #1a2040", overflow: "hidden" },
  cardHeader: { display: "flex", alignItems: "center", gap: 10, padding: "14px 14px 10px", borderBottom: "1px solid #1a2040" },
  cardName: { fontSize: 14, fontWeight: 700 },
  cardPts: { fontSize: 12, color: "#6b7a99" },
  cardTeams: { padding: "10px 14px 14px" },
  teamRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 7 },
  potTag: { fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, flexShrink: 0 },
  teamName: { fontSize: 13, fontWeight: 600, flex: 1 },
  record: { fontSize: 11, color: "#6b7a99" },
  footer: { padding: "16px 20px", borderTop: "1px solid #1a2040", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "#4a5568" },
  resetBtn: { background: "none", border: "none", color: "#4a5568", fontSize: 11, cursor: "pointer", textDecoration: "underline" },
};
