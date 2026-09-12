#!/usr/bin/env bash
#
# Installation de l'orchestrateur LLM multi-plateforme (serveur MCP).
# Inscrit automatiquement le serveur dans : Opencode, Cursor, Claude Code, Windsurf.
#
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"

# ---------- Intégrité : SHA-256 épinglés des fichiers téléchargés ----------
# Ce sont les empreintes des fichiers actuels du dépôt officiel. Toute modification
# de install.sh + fichiers servis doit mettre à jour ces empreintes à l'identique.
readonly SERVER_SHA256="22f0810a17b4c2279eb0cb810bc643ed10705960352e7f0c900b73928344602d"
readonly HOSTED_SHA256="b5fd6b122c1247539068135c3f7889a8998de24b4e2ec5226505cce2ef432c2b"
readonly MEMORY_SHA256="7f5136c9e868f61bbdad1e2fa1bcddf9352e8006da6502c06b82fb04e5d39c0f"
readonly MODELS_SHA256="999be1b498d1fbc5e714c73a86d8250357629af6ca49d7299c8f4a485a331e66"
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" 2>/dev/null | awk '{print $1}'
  else echo ""; fi
}
verify_sha256() {
  local file="$1" expected="$2" actual
  actual="$(sha256_of "$file")"
  [ -n "$actual" ] && [ "$actual" = "$expected" ]
}

# ---------- Résolution du dossier d'installation ----------
# - Exécution depuis un clone  -> dossier du script
# - Exécution via curl | bash  -> ~/.llm-orchestrator-mcp (téléchargement auto)
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/server.js" ]; then
  DIR="$SCRIPT_DIR"
else
  DIR="$HOME/.llm-orchestrator-mcp"
  mkdir -p "$DIR"
  for f in server.js hosted.js memory.js models.json; do
    if [ ! -f "$DIR/$f" ]; then
      if ! curl -fsSL "$REPO_RAW/$f" -o "$DIR/$f"; then
        echo "Téléchargement de $f impossible" >&2; rm -f "$DIR/$f"; exit 1
      fi
    fi
  done
  # Vérification d'intégrité (échec = abandon immédiat, jamais d'exécution sans contrôle)
  for f in server.js hosted.js memory.js models.json; do
    case "$f" in
      server.js)  expected="$SERVER_SHA256" ;;
      hosted.js)  expected="$HOSTED_SHA256" ;;
      memory.js)  expected="$MEMORY_SHA256" ;;
      models.json) expected="$MODELS_SHA256" ;;
    esac
    if ! verify_sha256 "$DIR/$f" "$expected"; then
      echo "ÉCHEC d'intégrité : $f ne correspond pas à l'empreinte officielle (SHA-256). Refusez d'exécuter ce fichier." >&2
      exit 1
    fi
  done
  echo "[install] Intégrité vérifiée (SHA-256) des 4 fichiers téléchargés."
fi
SERVER="$DIR/server.js"
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

# ---------- Backend : local | hosted | both ----------
# La clé hébergée, si fournie, est écrite UNIQUEMENT dans l'env block des
# configs client (hors du repo) — jamais dans un fichier du dépôt.
BACKEND_MODE="${KYBERNOS_MCP_BACKEND:-}"
HOSTED_URL="${KYBERNOS_MCP_URL:-}"
HOSTED_KEY="${KYBERNOS_API_KEY:-}"
if [ -z "$BACKEND_MODE" ] && [ -t 0 ] && [ -t 1 ]; then
  printf '\nBackend du serveur :\n  1) local  — tes propres clés LLM (défaut, gratuit)\n  2) hosted — outils Kybernos via le proxy (clé virtuelle kys-...)\n  3) both   — les deux\n'
  read -rp "Choix [1] : " backend_choice
  case "$backend_choice" in
    2) BACKEND_MODE="hosted" ;;
    3) BACKEND_MODE="both" ;;
    *) BACKEND_MODE="local" ;;
  esac
  if [ "$BACKEND_MODE" != "local" ]; then
    read -rp "URL du proxy Kybernos [https://api.dev.kybernos.app] : " HOSTED_URL
    HOSTED_URL="${HOSTED_URL:-https://api.dev.kybernos.app}"
    printf 'Clé virtuelle Kybernos (kys-...) : '
    read -rs HOSTED_KEY
    printf '\n'
  fi
elif [ -z "$BACKEND_MODE" ]; then
  BACKEND_MODE="local"
  log "Non interactif → backend local. Active le proxy avec KYBERNOS_MCP_BACKEND=hosted|both."
fi
# assainissement défensif (jamais de quote/backslash dans la clé)
HOSTED_KEY="${HOSTED_KEY//\"/}"; HOSTED_KEY="${HOSTED_KEY//\\/}"
HOSTED_URL="${HOSTED_URL//\"/}"

ENV_BLOCK=""
if [ "$BACKEND_MODE" != "local" ]; then
  ENV_BLOCK=", \"env\": { \"KYBERNOS_MCP_BACKEND\": \"$BACKEND_MODE\""
  if [ -n "$HOSTED_URL" ]; then
    ENV_BLOCK="$ENV_BLOCK, \"KYBERNOS_MCP_URL\": \"$HOSTED_URL\""
  fi
  if [ -n "$HOSTED_KEY" ]; then
    ENV_BLOCK="$ENV_BLOCK, \"KYBERNOS_API_KEY\": \"$HOSTED_KEY\""
  fi
  ENV_BLOCK="$ENV_BLOCK }"
fi

# ---------- Utilitaires JSON (jq en priorité, sinon node) ----------
if command -v jq >/dev/null 2>&1; then
  json_get()  { jq "$1" "$2" 2>/dev/null; }
  json_merge_write() { local filter="$1" file="$2"; local tmp; tmp="$(mktemp)"; jq "$filter" "$file" > "$tmp" && mv "$tmp" "$file"; }
else
  json_get() {
    local path="$1" file="$2"
    node -e '
      const fs=require("fs");
      const A=process.argv.slice(-2);
      const path=A[0],file=A[1];
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
# Tolère l'JSONC (commentaires // et /* */) via le fallback node : si le
# fichier contient des commentaires, une copie .bak-install est conservée.
merge_config() {
  local file="$1"        # fichier cible
  local path="$2"        # chemin pointé, ex: mcpServers  ou  projects."/chemin".mcpServers
  local payload="$3"     # JSON à fusionner
  [ -f "$file" ] || echo '{}' > "$file"
  if command -v jq >/dev/null 2>&1 && jq empty "$file" >/dev/null 2>&1; then
    local tmp; tmp="$(mktemp)"
    if jq --argjson p "$payload" --arg path "$path" '
      def setpath_obj($keys; $val):
        if ($keys | length) == 0 then $val
        else .[$keys[0]] = ((.[$keys[0]] // {}) | setpath_obj($keys[1:]; $val))
        end;
      setpath_obj($path | split("."); $p)
    ' "$file" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
      mv "$tmp" "$file"
      return 0
    fi
    rm -f "$tmp"
  fi
  node -e '
    const fs=require("fs");
    const A=process.argv.slice(-3);
    const file=A[0],pathExpr=A[1],payload=A[2];
    const strip=(s)=>{let out="",i=0,n=s.length;
      while(i<n){const c=s[i];
        if(c==="\""){out+=c;i++;while(i<n){if(s[i]==="\\"){out+=s[i]+(s[i+1]||"");i+=2;continue;}out+=s[i];if(s[i]==="\""){i++;break;}i++;}continue;}
        if(c==="/"&&s[i+1]==="/"){while(i<n&&s[i]!=="\n")i++;continue;}
        if(c==="/"&&s[i+1]==="*"){i+=2;while(i<n&&!(s[i]==="*"&&s[i+1]==="/"))i++;i+=2;continue;}
        out+=c;i++;}
      return out;};
    let src;try{src=fs.readFileSync(file,"utf8");}catch{src="{}";}
    let doc;
    try{doc=JSON.parse(src);}
    catch(e){
      const backup=file+".bak-install";
      try{fs.copyFileSync(file,backup);}catch{}
      doc=JSON.parse(strip(src)); // JSONC toléré (commentaires retirés, backup conservé)
      process.stderr.write("[install] commentaires retirés de "+file+" (backup : "+backup+")\n");
    }
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
}

# ---------- Retrait JSON générique (clé supprimée, autres clés intactes) ----------
# Miroir de merge_config avec sémantique de SUPPRESSION : retire la clé $NAME sous le
# chemin pointé, n'ajoute jamais rien, ne touche à aucune autre clé.
remove_config() {
  local file="$1" path="$2"
  [ -f "$file" ] || return 0
  node -e '
    const fs=require("fs");
    const A=process.argv.slice(-2);
    const file=A[0],pathExpr=A[1];
    const strip=(s)=>{let out="",i=0,n=s.length;
      while(i<n){const c=s[i];
        if(c==="\""){out+=c;i++;while(i<n){if(s[i]==="\\"){out+=s[i]+(s[i+1]||"");i+=2;continue;}out+=s[i];if(s[i]==="\""){i++;break;}i++;}continue;}
        if(c==="/"&&s[i+1]==="/"){while(i<n&&s[i]!=="\n")i++;continue;}
        if(c==="/"&&s[i+1]==="*"){i+=2;while(i<n&&!(s[i]==="*"&&s[i+1]==="/"))i++;i+=2;continue;}
        out+=c;i++;}
      return out;};
    let src;try{src=fs.readFileSync(file,"utf8");}catch{process.exit(0);}
    let doc;
    try{doc=JSON.parse(src);}
    catch(e){
      const backup=file+".bak-remove";
      try{fs.copyFileSync(file,backup);}catch{}
      try{doc=JSON.parse(strip(src));}
      catch(err){process.exit(0);}
      process.stderr.write("[install] commentaires retirés de "+file+" (backup : "+backup+")\n");
    }
    const parts=pathExpr.match(/[^.]+|\["[^"]+"\]/g)||[];
    let v=doc, parent=null, lastKey=null;
    for(let i=0;i<parts.length;i++){
      const k=parts[i].replace(/^\["|"\]$/g,"");
      if(typeof v!=="object"||v===null) process.exit(0);
      if(i===parts.length-1){ lastKey=k; parent=v; }
      else v=v[k];
    }
    if(parent && lastKey && (lastKey in parent)){ delete parent[lastKey]; fs.writeFileSync(file,JSON.stringify(doc,null,2)+"\n",(e)=>{ if(e) process.exit(1); }); }
    else process.exit(0);
  ' "$file" "$path"
}

# ---------- 1) Opencode (~/.config/opencode/opencode.json[.jsonc]) ----------
install_opencode() {
  local cfg="${OPENCODE_CONFIG:-}"
  if [ -z "$cfg" ]; then
    local d="$HOME/.config/opencode"
    if [ -f "$d/opencode.jsonc" ]; then
      cfg="$d/opencode.jsonc"    # opencode.jsonc prioritaire s'il existe
    else
      cfg="$d/opencode.json"
    fi
  fi
  mkdir -p "$(dirname "$cfg")"
  merge_config "$cfg" 'mcp' "$(cat <<EOF
{ "$NAME": { "type": "local", "command": ["node", "$SERVER"], "enabled": true$ENV_BLOCK } }
EOF
)"
  merge_config "$cfg" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "type": "local", "command": ["node", "$SERVER"]$ENV_BLOCK } }
EOF
)"
  log "Opencode      -> $cfg"
}

# ---------- 2) Cursor (~/.cursor/mcp.json) ----------
install_cursor() {
  local cfg="${CURSOR_CONFIG:-$HOME/.cursor/mcp.json}"
  mkdir -p "$(dirname "$cfg")"
  merge_config "$cfg" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "command": "node", "args": ["$SERVER"]$ENV_BLOCK } }
EOF
)"
  log "Cursor        -> $cfg"
}

# ---------- 3) Claude Code (~/.claude.json + .mcp.json projet) ----------
install_claude() {
  local global_cfg="${CLAUDE_CONFIG:-$HOME/.claude.json}"
  [ -f "$global_cfg" ] || echo '{}' > "$global_cfg"
  merge_config "$global_cfg" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "type": "stdio", "command": "node", "args": ["$SERVER"]$ENV_BLOCK } }
EOF
)"
  log "Claude Code   -> $global_cfg (global)"
  # Option projet : inscription SANS env — jamais de clé dans un fichier du repo.
  local proj="$DIR/.mcp.json"
  merge_config "$proj" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "type": "stdio", "command": "node", "args": ["$SERVER"] } }
EOF
)"
  log "Claude Code   -> $proj (projet, sans clé)"
}

# ---------- 4) Windsurf (~/.codeium/windsurf/mcp_config.json) ----------
install_windsurf() {
  local cfg="${WINDSURF_CONFIG:-$HOME/.codeium/windsurf/mcp_config.json}"
  mkdir -p "$(dirname "$cfg")"
  merge_config "$cfg" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "command": "node", "args": ["$SERVER"]$ENV_BLOCK } }
EOF
)"
  log "Windsurf      -> $cfg"
}

# ---------- 5) Kimi Code / Kimi CLI (~/.kimi/mcp.json) ----------
install_kimi() {
  local cfg="${KIMI_CONFIG:-$HOME/.kimi/mcp.json}"
  mkdir -p "$(dirname "$cfg")"
  merge_config "$cfg" 'mcpServers' "$(cat <<EOF
{ "$NAME": { "command": "node", "args": ["$SERVER"]$ENV_BLOCK } }
EOF
)"
  log "Kimi Code     -> $cfg"
}

# ---------- Désinstallation (--remove) : retire uniquement ce que l'install a ajouté ----------
uninstall_opencode() {
  local cfg="${OPENCODE_CONFIG:-}"
  if [ -z "$cfg" ]; then
    local d="$HOME/.config/opencode"
    if [ -f "$d/opencode.jsonc" ]; then cfg="$d/opencode.jsonc"; else cfg="$d/opencode.json"; fi
  fi
  remove_config "$cfg" "mcp.$NAME"
  remove_config "$cfg" "mcpServers.$NAME"
  echo "  retiré : $cfg (llm-orchestrator)"
}
uninstall_cursor() {
  local cfg="${CURSOR_CONFIG:-$HOME/.cursor/mcp.json}"
  remove_config "$cfg" "mcpServers.$NAME"
  echo "  retiré : $cfg (llm-orchestrator)"
}
uninstall_claude() {
  local global_cfg="${CLAUDE_CONFIG:-$HOME/.claude.json}"
  remove_config "$global_cfg" "mcpServers.$NAME"
  echo "  retiré : $global_cfg (global)"
  remove_config "$DIR/.mcp.json" "mcpServers.$NAME"
  echo "  retiré : $DIR/.mcp.json (projet)"
}
uninstall_windsurf() {
  local cfg="${WINDSURF_CONFIG:-$HOME/.codeium/windsurf/mcp_config.json}"
  remove_config "$cfg" "mcpServers.$NAME"
  echo "  retiré : $cfg (llm-orchestrator)"
}
uninstall_kimi() {
  local cfg="${KIMI_CONFIG:-$HOME/.kimi/mcp.json}"
  remove_config "$cfg" "mcpServers.$NAME"
  echo "  retiré : $cfg (llm-orchestrator)"
}

if [ "${1:-}" = "--remove" ]; then
  echo "Désinstallation de $NAME :"
  uninstall_opencode
  uninstall_cursor
  uninstall_claude
  uninstall_windsurf
  uninstall_kimi
  # Seulement si installé hors clone (dossier téléchargé ~/.llm-orchestrator-mcp)
  if [ -d "$HOME/.llm-orchestrator-mcp" ]; then
    rm -rf "$HOME/.llm-orchestrator-mcp"
    echo "  supprimé : $HOME/.llm-orchestrator-mcp"
  fi
  echo "Terminé. Désinstallation propre — aucune entrée des autres outils n'a été touchée."
  exit 0
fi

install_opencode
install_cursor
install_claude
install_windsurf
install_kimi

# ---------- Clés API ----------
log "Backend configuré : $BACKEND_MODE"
if [ "$BACKEND_MODE" != "local" ]; then
  log "Proxy Kybernos : ${KYBERNOS_MCP_URL:-$HOSTED_URL} (clé écrite uniquement dans tes configs client)"
fi
cat <<'EOF'

Clés API optionnelles (au moins une est nécessaire pour les modèles locaux) :
  export OPENAI_API_KEY=...        # GPT-5
  export ANTHROPIC_API_KEY=...     # Claude 4.5
  export GEMINI_API_KEY=...        # Gemini 3
  export MISTRAL_API_KEY=...       # Mistral Large 2
  export GROQ_API_KEY=...          # Llama 4 (via Groq)

Le serveur les lit depuis l'environnement du client (Opencode, Cursor...).
Astuce : renseigne-les dans ton shell profile (~/.zshrc) pour qu'elles soient
transmises aux clients lancés depuis le terminal.

EOF

log "Terminé. Redémarre Opencode / Cursor / Claude Code / Windsurf / Kimi Code pour charger le serveur."
log "Ensuite, demande à ton agent : « teste la santé des modèles et choisis le meilleur »."