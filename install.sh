#!/bin/sh
set -eu
umask 077

LC_ALL=C
export LC_ALL

env_tmp=
tty_state=

cleanup() {
  if [ -n "$tty_state" ]; then
    stty "$tty_state" 2>/dev/null || :
    tty_state=
  fi
  if [ -n "$env_tmp" ] && [ -e "$env_tmp" ]; then
    rm -f "$env_tmp"
  fi
}

trap cleanup 0
trap 'exit 1' 1 2 3 15

die() {
  printf 'install.sh: %s\n' "$1" >&2
  exit 1
}

read_env_value() {
  env_name=$1
  env_path=$2
  env_count=$(
    awk -v key="$env_name" '
      index($0, key "=") == 1 { count += 1 }
      END { print count + 0 }
    ' "$env_path"
  )
  [ "$env_count" -eq 1 ] || return 1
  awk -v key="$env_name" '
    index($0, key "=") == 1 {
      print substr($0, length(key) + 2)
      exit
    }
  ' "$env_path"
}

is_plausible_fal_key() {
  candidate=$1
  [ "${#candidate}" -ge 20 ] || return 1
  case "$candidate" in
    *[!A-Za-z0-9._:-]* | your-* | changeme | replace-me | example) return 1 ;;
  esac
  return 0
}

is_valid_password() {
  candidate=$1
  [ "${#candidate}" -ge 16 ] || return 1
  case "$candidate" in
    your-* | changeme | replace-me | example) return 1 ;;
  esac
  return 0
}

is_valid_session_secret() {
  candidate=$1
  [ "${#candidate}" -ge 32 ] || return 1
  case "$candidate" in
    your-* | changeme | replace-me | example) return 1 ;;
  esac
  return 0
}

validate_existing_env() {
  existing_fal_key=$(read_env_value "FAL_KEY" ".env") || return 1
  existing_password=$(read_env_value "STUDIO_PASSWORD" ".env") || return 1
  existing_session_secret=$(
    read_env_value "STUDIO_SESSION_SECRET" ".env"
  ) || return 1

  is_plausible_fal_key "$existing_fal_key" &&
    is_valid_password "$existing_password" &&
    is_valid_session_secret "$existing_session_secret"
}

random_hex() {
  random_bytes=$1
  random_value=$(
    od -An -N "$random_bytes" -tx1 /dev/urandom | tr -d ' \n'
  )
  expected_length=$((random_bytes * 2))
  [ "${#random_value}" -eq "$expected_length" ] ||
    die "Could not generate secure random credentials."
  printf '%s' "$random_value"
}

write_env_entry() {
  printf '%s=%s\n' "$1" "$2"
}

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
cd "$script_dir"

command -v docker >/dev/null 2>&1 ||
  die "Docker is required. Install Docker, then rerun this script."
docker compose version >/dev/null 2>&1 ||
  die "Docker Compose v2 is required. Install the docker compose plugin."

if [ -e ".env" ]; then
  [ ! -L ".env" ] && [ -f ".env" ] ||
    die "Existing .env must be a regular file, not a link or directory."
  validate_existing_env ||
    die "Existing .env is invalid. Fix FAL_KEY, STUDIO_PASSWORD (16+ characters), and STUDIO_SESSION_SECRET (32+ bytes), or move it aside before rerunning."
  chmod 600 ".env"
  printf '%s\n' "Using validated existing .env; it was not overwritten."
else
  printf '%s' "Enter your FAL key: " >&2
  if [ -t 0 ]; then
    tty_state=$(stty -g) || die "Could not disable terminal echo."
    stty -echo || die "Could not disable terminal echo."
    if ! IFS= read -r fal_key; then
      die "Could not read FAL_KEY."
    fi
    stty "$tty_state"
    tty_state=
    printf '\n' >&2
  else
    if ! IFS= read -r fal_key; then
      die "Could not read FAL_KEY."
    fi
  fi

  is_plausible_fal_key "$fal_key" ||
    die "Enter a valid FAL_KEY as one line with at least 20 key characters."

  generated_pass=$(random_hex 24)
  session_secret=$(random_hex 32)
  env_tmp=".env.tmp.$$"
  if ! (set -C; : > "$env_tmp") 2>/dev/null; then
    die "Could not create a private temporary environment file."
  fi
  chmod 600 "$env_tmp"
  {
    write_env_entry "FAL_KEY" "$fal_key"
    write_env_entry "STUDIO_PASSWORD" "$generated_pass"
    write_env_entry "STUDIO_SESSION_SECRET" "$session_secret"
    write_env_entry "BIND_ADDRESS" "127.0.0.1"
    write_env_entry "PORT" "3000"
    write_env_entry "AUDIO_STUDIO_VERSION" "latest"
  } > "$env_tmp"
  if ! ln "$env_tmp" ".env" 2>/dev/null; then
    die "Existing .env appeared during setup; it was not overwritten. Validate it or move it aside before rerunning."
  fi
  rm -f "$env_tmp"
  env_tmp=
  printf '%s\n' "Created private .env with generated credentials."
fi

if docker compose pull audio-studio; then
  printf '%s\n' "Pulled the released Audio Studio image."
else
  printf '%s\n' "Released image unavailable; building Audio Studio locally." >&2
  docker compose build audio-studio
fi

docker compose up -d --no-build

attempt=0
health_status=
while [ "$attempt" -lt 60 ]; do
  container_id=$(docker compose ps -q audio-studio 2>/dev/null || :)
  if [ -n "$container_id" ]; then
    health_status=$(
      docker inspect \
        --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$container_id" 2>/dev/null || :
    )
    case "$health_status" in
      healthy) break ;;
      unhealthy | exited | dead) break ;;
    esac
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$health_status" != "healthy" ]; then
  printf '%s\n' "Audio Studio did not become healthy in time." >&2
  docker compose ps audio-studio >&2 || :
  docker compose logs --no-color --tail 100 audio-studio >&2 || :
  exit 1
fi

bind_address=$(
  read_env_value "BIND_ADDRESS" ".env" 2>/dev/null ||
    printf '%s' "127.0.0.1"
)
port=$(
  read_env_value "PORT" ".env" 2>/dev/null ||
    printf '%s' "3000"
)
[ -n "$bind_address" ] || bind_address=127.0.0.1
case "$port" in
  '' | *[!0-9]*) port=3000 ;;
esac
case "$bind_address" in
  0.0.0.0 | :: | '[::]') public_host=localhost ;;
  *) public_host=$bind_address ;;
esac
case "$public_host" in
  *:*) public_host="[$public_host]" ;;
esac

printf 'Audio Studio is healthy at http://%s:%s\n' "$public_host" "$port"
printf '%s\n' "Credentials are stored in .env; keep this file private."
