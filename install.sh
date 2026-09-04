#!/usr/bin/env bash
#
# Installation de l'orchestrateur LLM multi-plateforme (serveur MCP).
# Inscrit automatiquement le serveur dans : Opencode, Cursor, Claude Code, Windsurf.
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$DIR/server.js"
COMMAND="node $SERVER"
NAME="llm-orchestrator"

log()  { printf '\033[1;32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m %s\n' "$*"; }

# ---------- Vérifications ----------
if ! command -v node >/dev/null 2>&1; then
  echo "node (>= 18) est requis : https://nodejs.org" >&2; exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node >= 18 requis (trouvé : $(node -v))." >&2; exit 1
fi

if [ ! -f "$SERVER" ]; then
  echo "server.js introuvable dans $DIR" >&2; exit 1
fi

chmod +x "$SERVER" 2>/dev/null || true

# ---------- Utilitaires JSON (jq en priorité, sinon node) ----------
if command -v jq >/dev/null 2>&1; then
  json_get()  { jq "$1" "$2" 2>/dev/null; }
  json_merge_write() { local filter="$1" file="$2"; local tmp; tmp="$(mktemp)"; jq "$filter" "$file" > "$tmp" && mv "$tmp" "$file"; }
else
  json_get() {
    local path="$1" file="$2"
    node -e '
      const fs=require("fs");
      const [,path,file]=process.argv;
      const doc=JSON.parse(fs.readFileSync(file,"utf8"));
      const keys=path.replace(/^"/,"").replace(/"$/,"").split(".");
      let v=doc;
      for(const k of keys){ if(v==null){v=undefined;break;} v=v[k]; }
      console.log(typeof v==="string"?v:JSON.stringify(v));
    ' "$path" "$file" 2>/dev/null
  }
  json_merge_write() {
    local filter="$1" file="$2"
    node -e '
      const fs=require("fs");
      const [filter,file]=process.argv;
      // filter: chemin pointé vers un objet à écrire, ex: mcpServers
      // payload lu sur stdin (JSON)
      let payload="";process.stdin.on("data",d=>payload+=d).on("end",()=>{
        const doc=JSON.parse(fs.readFileSync(file,"utf8"));
        const keys=filter.split(".");
        let v=doc;
        for(let i=0;i<keys.length-1;i++){ v=keys[i] in v? v[keys[i]] : (v[keys[i]]={}); }
        v[keys[keys.length-1]]=JSON.parse(payload);
        fs.writeFileSync(file,JSON.stringify(doc,null,2));
      });
    ' "$filter" "$file" <<< "$3"
  }
fi

# ---------- Fusion JSON générique dans un fichier de config ----------
merge_config() {
  local file="$1"        # fichier cible
  local path="$2"        # chemin pointé, ex: mcpServers  ou  projects."/chemin".mcpServers
  local payload="$3"     # JSON à fusionner
  [ -f "$file" ] || echo '{}' > "$file"
  if command -v jq >/dev/null 2>&1; then
    local tmp; tmp="$(mktemp)"
    jq --argjson p "$payload" --arg path "$path" '
      def setpath_obj($keys; $val):
        if ($keys | length) == 0 then $val
        else .[$keys[0]] = ((.[$keys[0]] // {}) | setpath_obj($keys[1:]; $val))
        end;
      setpath_obj($path | split("."); $p)
    ' "$file" > "$tmp" && mv "$tmp" "$file"
  else
    node -e '
      const fs=require("fs");
      const [file,pathExpr,payload]=process.argv;
      const doc=JSON.parse(fs.readFileSync(file,"utf8"));
      const parts=pathExpr.match(/[^.]+|\["[^"]+"\]/g)||[];
      let v=doc;
      for(let i=0;i<parts.length-1;i++){
        const k=parts[i].replace(/^\["|"\]$/g,"");
        if(!(k in v)) v[k]=/^\[/.test(parts[i+1])?[]:{};
        v=v[k];
      }
      const last=parts[parts.length-1].replace(/^\["|"\]$/g,"");
      v[last]=Object.assign({},v[last]||{},JSON.parse(payload));
      fs.writeFileSync(file,JSON.stringify(doc,null,2)+"\n");
    ' "$file" "$path" "$payload"
  fi
}

# ---------- 1) Opencode (~/.config/opencode/opencode.json) ----------
install_opencode() {
  local cfg="${OPENCODE_CONFIG:-$HOME/.config/opencode/opencode.json}"
  mkdir -p "$(dirname "$cfg")"
  merge_config "$cfg" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "type": "local", "command": ["node", "$SERVER"] } }
EOF
)"
  log "Opencode      -> $cfg"
}

# ---------- 2) Cursor (~/.cursor/mcp.json) ----------
install_cursor() {
  local cfg="${CURSOR_CONFIG:-$HOME/.cursor/mcp.json}"
  mkdir -p "$(dirname "$cfg")"
  merge_config "$cfg" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "command": "node", "args": ["$SERVER"] } }
EOF
)"
  log "Cursor        -> $cfg"
}

# ---------- 3) Claude Code (~/.claude.json + .mcp.json projet) ----------
install_claude() {
  local global_cfg="${CLAUDE_CONFIG:-$HOME/.claude.json}"
  [ -f "$global_cfg" ] || echo '{}' > "$global_cfg"
  merge_config "$global_cfg" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "type": "stdio", "command": "node", "args": ["$SERVER"] } }
EOF
)"
  log "Claude Code   -> $global_cfg (global)"
  # Option projet : si un .mcp.json existe à côté, on y inscrit aussi le serveur
  local proj="$DIR/.mcp.json"
  merge_config "$proj" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "type": "stdio", "command": "node", "args": ["$SERVER"] } }
EOF
)"
  log "Claude Code   -> $proj (projet)"
}

# ---------- 4) Windsurf (~/.codeium/windsurf/mcp_config.json) ----------
install_windsurf() {
  local cfg="${WINDSURF_CONFIG:-$HOME/.codeium/windsurf/mcp_config.json}"
  mkdir -p "$(dirname "$cfg")"
  merge_config "$cfg" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "command": "node", "args": ["$SERVER"] } }
EOF
)"
  log "Windsurf      -> $cfg"
}

install_opencode
install_cursor
install_claude
install_windsurf

# ---------- Clés API ----------
cat <<'EOF'

Clés API optionnelles (au moins une est nécessaire pour activer un modèle) :
  export OPENAI_API_KEY=...        # GPT-5
  export ANTHROPIC_API_KEY=...     # Claude 4.5
  export GEMINI_API_KEY=...        # Gemini 3
  export MISTRAL_API_KEY=...       # Mistral Large 2
  export GROQ_API_KEY=...          # Llama 4 (via Groq)

Le serveur les lit depuis l'environnement du client (Opencode, Cursor...).
Astuce : renseigne-les dans ton shell profile (~/.zshrc) pour qu'elles soient
transmises aux clients lancés depuis le terminal.

EOF

log "Terminé. Redémarre Opencode / Cursor / Claude Code / Windsurf pour charger le serveur."
log "Ensuite, demande à ton agent : « teste la santé des modèles et choisis le meilleur »."