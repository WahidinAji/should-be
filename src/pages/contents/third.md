---
layout: ../../layouts/ContentLayout.astro
title: "nftables: Cheat code or AI Slop?"
description: A practical, syntax-first guide to nftables and Linux packet filtering.
date: 2026-09-23
tags:
  - linux
  - networking
  - nftables
  - firewall
  - notes
---

<div data-lang="en" hidden>

## What nftables actually is

The firewall in Linux is **netfilter**, a framework inside the kernel. It places checkpoints, called **hooks**, along the path a packet travels. **nftables** is just the tool you use to attach rules to those hooks. (`iptables` is the older tool that did the same job with a clunkier syntax.)

Before writing any rule, you need three bits of networking background:

- **Interfaces** — how the machine talks to networks: `eth0`, `wlan0`, `lo` (loopback, the machine talking to itself), `wg0` (VPN), `docker0`. See them with `ip addr`.
- **Packets** — every packet has an IP header (**which machine**: source/destination address) and a TCP/UDP header (**which program**: source/destination port). Firewall rules are just questions about these fields.
- **Routing** — for every incoming packet the kernel asks: *"is this for me, or for someone else?"* See the routing table with `ip route`.

## The packet flow (the most important picture)

```
                                ┌───────────────┐
 packet in ──► prerouting ────► │    routing    │ ────► forward ────────────┐
                                │ for me / not? │                           │
                                └───────┬───────┘                           ▼
                                        ▼                             postrouting ──► packet out
                                      input                                 ▲
                                        ▼                                   │
                                  local process                             │
                                 (sshd, nginx...)                           │
                                        ▼                                   │
                                     output ────────────────────────────────┘
```

A packet can only take three paths:

| Path                | Hooks                                   | Typical use                               |
| ------------------- | --------------------------------------- | ----------------------------------------- |
| **Incoming to you** | `prerouting` → `input` → program        | Protect a server ("only allow SSH + web") |
| **Outgoing from you** | program → `output` → `postrouting`    | Usually left open                         |
| **Passing through** | `prerouting` → `forward` → `postrouting` | Routers, VPN servers, Docker hosts       |

This is why server firewalls mostly live in `input`, and why port forwarding (DNAT) lives in `prerouting`: the destination must be changed **before** the routing decision.

## The shape of every config

```
table <family> <name> {            # a folder that holds chains
    chain <name> {                 # a list of rules
        <settings line>            # connects the chain to a hook (optional)
        <rule>                     # conditions ... action
    }
}
```

Only three levels: **table → chain → rules**. Every line inside a chain is either the **settings line** or a **rule**.

Two ways to work with nftables:

- **Commands** (`nft add ...`) — change the live ruleset immediately, lost on reboot unless saved.
- **Config files** (`nft -f file`) — describe the whole ruleset at once. Use these for anything permanent.

## Viewing and loading

```bash
nft list ruleset                 # show everything currently active
nft -a list ruleset              # same, plus "handle" numbers on each rule (needed to delete)
nft list tables                  # just the table names
nft list table inet filter       # one table: family "inet", name "filter"
nft list chain inet filter input # one chain inside that table

nft -f /etc/nftables.conf        # load a config file (atomic: all or nothing)
nft -c -f /etc/nftables.conf     # -c = check only: validate syntax, change nothing
nft list ruleset > backup.nft    # save what's active (reload it with nft -f)
nft monitor                      # live stream of rule changes and events
```

`-a` = annotate (show handles), `-c` = check, `-f` = file.

## Tables

```bash
nft add table inet filter        # create table: family "inet", name "filter" (name is your choice)
nft delete table inet filter     # remove it and everything inside (errors if missing)
nft destroy table inet filter    # same, but no error if missing (nftables 1.0.8+ / kernel 6.3+)
nft flush table inet filter      # empty all its chains' rules, keep the chains
nft flush ruleset                # wipe EVERY table, including Docker's etc.
```

The **family** decides what traffic the table sees:

| Family   | Sees                                                  |
| -------- | ----------------------------------------------------- |
| `inet`   | IPv4 + IPv6 together — use this for filtering         |
| `ip`     | IPv4 only — common for NAT tables                     |
| `ip6`    | IPv6 only                                             |
| `bridge` | traffic crossing a Linux bridge (layer 2)             |
| `netdev` | very early, per interface (e.g. DDoS drop at ingress) |
| `arp`    | ARP packets                                           |

## Chains and the settings line

```bash
chain input {
    type filter hook input priority 0; policy drop;
}
```

Broken apart:

```
chain input        # the chain's NAME — just a label, could be anything
type filter        # what the chain does: filter | nat | route
hook input         # which checkpoint it attaches to (the real meaning)
priority 0         # order among chains on the same hook: lower runs first
policy drop        # default verdict if no rule decides: accept | drop
;                  # separates the settings
```

Watch out: `input` appears twice. The first is only a **name**; `hook input` is the actual **checkpoint**. `chain bouncer { type filter hook input ... }` works exactly the same.

Hooks:

| Hook          | Where                                                    |
| ------------- | -------------------------------------------------------- |
| `prerouting`  | every incoming packet, before "is this for me?"          |
| `input`       | packets destined for this machine                        |
| `forward`     | packets passing through to another machine               |
| `output`      | packets created by this machine                          |
| `postrouting` | every outgoing packet, just before leaving               |
| `ingress`     | (`netdev` family) earliest point on an interface         |

Named priorities you'll see:

```
dstnat  = -100   # DNAT in prerouting (runs before filtering)
filter  =    0   # normal filtering
srcnat  =  100   # SNAT / masquerade in postrouting
```

Chains as commands:

```bash
nft add chain inet filter input '{ type filter hook input priority 0; policy drop; }'
#   │   │     │          │       └─ settings; quotes stop bash from eating { } and ;
#   │   │     │          └─ new chain's name
#   │   │     └─ which table (family + name)
#   │   └─ what we're adding
#   └─ the action

nft add chain inet filter my_ssh                   # "regular" chain: no hook, runs only via jump
nft chain inet filter input '{ policy accept; }'   # change just the policy
nft flush chain inet filter input                  # remove all rules in this chain
nft delete chain inet filter my_ssh                # remove chain (must be empty & unreferenced)
```

## Anatomy of a rule

```
[conditions ...]  [statements ...]  [verdict]
```

Read it as a sentence: **if** all conditions match, **then** do the statements, then the verdict.

```bash
ip saddr 10.0.0.5 tcp dport 22 counter accept
# └─ condition ──┘ └─ condition ┘ └stmt┘ └verdict┘
# "if source is 10.0.0.5 AND TCP destination port is 22, count it, then accept"
```

- Multiple conditions in one rule = **AND**.
- Commas / `{ }` sets inside a condition = **OR**.
- Rules run **top to bottom**; the first `accept` or `drop` ends the chain. Order matters.

Managing rules by command:

```bash
nft add rule inet filter input tcp dport 22 accept                # append to end
nft insert rule inet filter input tcp dport 22 accept             # put at start
nft add rule inet filter input position 7 tcp dport 80 accept     # after handle 7
nft insert rule inet filter input position 7 tcp dport 80 accept  # before handle 7
nft replace rule inet filter input handle 7 tcp dport 2222 accept # overwrite handle 7
nft delete rule inet filter input handle 7                        # delete (get handle with -a)
```

## Conditions (matches)

### Addresses

```bash
ip saddr 192.168.1.10          # IPv4 source address ("s" = source)
ip daddr 10.0.0.0/8            # IPv4 destination ("d" = destination), /8 = subnet
ip6 saddr 2001:db8::/32        # IPv6 source
ip saddr != 10.0.0.0/8         # != means "NOT this"
ip saddr 10.0.0.1-10.0.0.50    # a range
ip saddr { 1.2.3.4, 5.6.7.8 }  # { } = anonymous set: ANY of these
```

### Ports and protocols

```bash
tcp dport 22                   # TCP destination port 22
tcp dport { 80, 443 }          # port 80 OR 443
tcp dport 8000-8100            # port range
udp sport 53                   # UDP source port 53
meta l4proto { tcp, udp } th dport 53
#    │                    └─ th = "transport header": port for tcp OR udp
#    └─ l4proto = layer-4 protocol
ip protocol icmp               # IPv4 packets carrying ICMP
meta l4proto { icmp, ipv6-icmp }   # ICMP for IPv4 + IPv6 (use in inet tables)
icmp type echo-request         # IPv4 ping
icmpv6 type echo-request       # IPv6 ping
```

### Interfaces

```bash
iif lo                         # input interface (by index) — fast, for permanent interfaces
oif eth0                       # output interface (by index)
iifname "wg0"                  # input interface by NAME — for interfaces that come and go
oifname "eth0"                 # output interface by name
iifname "docker*"              # wildcard
```

Rule of thumb: `iif` for `lo` and fixed interfaces, `iifname` for VPNs, containers, and anything that may not exist when rules load.

### Connection tracking (`ct`)

```bash
ct state new                   # first packet of a new connection
ct state established           # part of an already-approved connection
ct state related               # new but linked to an existing one (ICMP errors, FTP data)
ct state invalid               # makes no sense — drop these
ct state established,related   # comma = OR
```

This is the secret sauce. When you `curl google.com`, the **reply** comes back into your machine and hits the `input` chain. `ct state established,related accept` lets all replies to approved connections through, so your other rules only have to decide about **new** connections.

### Other packet info (`meta`)

```bash
meta nfproto ipv4              # only IPv4 packets (useful inside inet tables)
meta mark 0x1                  # packet carries mark 1 (set earlier by another rule)
meta skuid 1000                # (output only) sent by a process of user ID 1000
```

### Abbreviations

| Short            | Means                                              |
| ---------------- | -------------------------------------------------- |
| `ct`             | connection tracking                                |
| `iif` / `oif`    | input / output interface (by index)                |
| `iifname` / `oifname` | input / output interface (by name)            |
| `saddr` / `daddr` | source / destination address                      |
| `sport` / `dport` | source / destination port                         |
| `l4proto`        | layer-4 protocol (tcp, udp, icmp)                  |
| `th`             | transport header (port for tcp or udp)             |
| `meta`           | packet info not in a header (interface, mark, ...) |

## Verdicts (the final decision)

```bash
accept                         # let it through (this chain is done)
drop                           # silently discard; sender gets no response
reject                         # discard and tell the sender "no"
reject with tcp reset          # reply with TCP RST ("connection refused")
reject with icmpx type admin-prohibited   # in inet tables use "icmpx" (v4 + v6)
jump my_ssh                    # run chain my_ssh, then come back
goto my_ssh                    # run chain my_ssh, don't come back
return                         # leave current chain (back to caller, or apply policy)
```

## Statements (do something, keep going)

```bash
counter                        # count packets/bytes (see with nft list ruleset)
log                            # write to kernel log (journalctl -k or dmesg)
log prefix "SSH-in: "          # add a label you can grep for
log prefix "DROP: " level warn # set severity
limit rate 10/second           # match only up to this rate
limit rate over 10/second      # match only when EXCEEDING this rate
meta mark set 0x1              # tag the packet
comment "allow ssh"            # note attached to the rule
```

Statements don't end the chain, so you can stack them: `counter log prefix "X: " drop`.

## What `policy drop` really means

`policy drop` on `input` = **any incoming packet that no rule accepts gets dropped**. Deny by default, allow by exception — like a guest list.

- **drop** — silently discards. The sender hangs until timeout. Reveals nothing.
- **reject** — discards and replies "no". The sender gets an instant "connection refused".

A policy can only be `accept` or `drop`. For reject behavior, add it as the last rule:

```bash
chain input {
    type filter hook input priority 0; policy drop;
    ct state established,related accept
    iif lo accept
    tcp dport 22 accept
    reject          # everything else gets a polite "no"
}
```

Walking packets through it:

- SSH to port 22 → matches `tcp dport 22 accept` → **in**.
- Someone tries port 3306 → matches nothing → **dropped** by policy.
- Your `curl google.com` gets a reply → matches `ct state established` → **in**.
- A local app talks to `127.0.0.1` → matches `iif lo accept` → **in**.

Forget the `ct state` line and apt, DNS, and every reply breaks. Forget `iif lo` and local software breaks. Forget port 22 and you're locked out.

## The forward chain

```bash
chain forward {
    type filter hook forward priority 0; policy drop;
}
```

No rules + `policy drop` = **never route anyone else's traffic**. Correct for a normal server or desktop. Linux also refuses to route unless forwarding is enabled:

```bash
sysctl net.ipv4.ip_forward       # 0 = off (default), 1 = on
```

When the machine **is** a router (`eth0` = internet, `eth1` = LAN):

```bash
chain forward {
    type filter hook forward priority 0; policy drop;
    ct state established,related accept     # replies to approved connections
    iifname "eth1" oifname "eth0" accept     # LAN → internet allowed
}                                            # internet → LAN dropped
```

VPN server: `iifname "wg0" oifname "eth0" accept`.

**Docker gotcha:** Docker enables forwarding and adds its own chains. A `drop` in **any** chain on a hook is final, so your `policy drop` on forward can cut containers off even though Docker's chain accepted them. Allow Docker's interfaces (e.g. `iifname "docker0" accept`, `oifname "docker0" accept`) and don't `flush ruleset` on a Docker host.

## Sets (lists you can update live)

```bash
table inet filter {
    set blocklist {
        type ipv4_addr             # what it holds
        flags interval             # allow ranges/subnets
        elements = { 10.0.0.0/8, 203.0.113.7 }
    }

    set temp_ban {
        type ipv4_addr
        flags timeout              # elements can expire
        timeout 1h                 # default lifetime
    }

    chain input {
        type filter hook input priority 0; policy drop;
        ip saddr @blocklist drop   # @name = "is it in this set?"
        ip saddr @temp_ban drop
    }
}
```

```bash
nft add element inet filter blocklist '{ 198.51.100.0/24 }'     # add
nft delete element inet filter blocklist '{ 203.0.113.7 }'      # remove
nft add element inet filter temp_ban '{ 1.2.3.4 timeout 10m }'  # add with expiry
nft list set inet filter blocklist                              # view
```

Set types: `ipv4_addr`, `ipv6_addr`, `inet_service` (ports), `ifname`, `ether_addr` (MAC).

## Maps (lookup tables)

```bash
tcp dport vmap { 22 : accept, 23 : drop, 80 : jump web }
# vmap = verdict map: look up the port, apply the verdict next to it

dnat to tcp dport map { 80 : 192.168.1.10, 443 : 192.168.1.11 }
# map = look up the port, use the result as NAT destination
```

## Rate limiting brute force (per IP)

```bash
table inet filter {
    set ssh_meter {
        type ipv4_addr
        flags dynamic              # rules can add entries on the fly
        timeout 1m                 # forget an IP after 1 min of silence
    }
    chain input {
        type filter hook input priority 0; policy drop;
        ct state established,related accept
        tcp dport 22 ct state new update @ssh_meter { ip saddr limit rate over 3/minute } drop
        # "if one IP opens more than 3 new SSH connections per minute, drop it"
        tcp dport 22 accept
    }
}
```

## NAT

```bash
table ip nat {                                     # "ip" family: simplest for IPv4 NAT
    chain prerouting {
        type nat hook prerouting priority dstnat;
        iifname "eth0" tcp dport 8080 dnat to 192.168.1.10:80
        # DNAT = change DESTINATION: public :8080 → internal server :80
        tcp dport 80 redirect to :3128
        # redirect = DNAT to this machine itself (e.g. local proxy)
    }
    chain postrouting {
        type nat hook postrouting priority srcnat;
        oifname "eth0" masquerade
        # masquerade = change SOURCE to eth0's current IP (dynamic IP)
        oifname "eth1" snat to 203.0.113.10
        # SNAT = change SOURCE to a fixed IP (static IP)
    }
}
```

In an `inet` table, say the IP version: `dnat ip to 192.168.1.10:80`. Routed NAT also needs `sysctl -w net.ipv4.ip_forward=1` plus forward-chain rules.

## Variables and includes

```bash
define LAN = 192.168.1.0/24        # define a variable
define WEB_PORTS = { 80, 443 }     # can hold sets

ip saddr $LAN accept               # $ = use it
tcp dport $WEB_PORTS accept

include "/etc/nftables.d/*.nft"    # split big configs into files
```

## To flush or not to flush

nftables never flushes by itself:

- `nft add ...` commands **append** to what exists.
- `nft -f file` runs what the file says. No `flush` inside = rules **stack on top** (load twice → duplicates).

`flush ruleset` at the top of a file makes the file the single source of truth, and because `nft -f` is atomic, there's never a moment without a firewall. But it wipes **every** table — Docker, libvirt, fail2ban, Tailscale, Kubernetes. On shared machines, reset only your own table:

```bash
# nftables 1.0.8+
destroy table inet myfw
table inet myfw { ... }

# older versions — create-then-delete idiom (delete errors if missing)
table inet myfw
delete table inet myfw
table inet myfw { ... }
```

Rule of thumb: dedicated box with nothing else touching the firewall → `flush ruleset` is fine. Anything else managing networking → reset only your table.

## A complete annotated server config

```bash
#!/usr/sbin/nft -f

define SSH_ALLOWED = { 203.0.113.0/24 }        # who can SSH in (adjust!)

table inet myfw                                 # reset only our table
delete table inet myfw

table inet myfw {
    chain input {
        type filter hook input priority filter; policy drop;

        ct state invalid drop                   # garbage packets: out
        ct state established,related accept     # replies to our connections: in
        iif lo accept                           # machine talking to itself: in

        meta l4proto { icmp, ipv6-icmp } accept # ping & ICMP (IPv6 breaks without ICMPv6)

        ip saddr $SSH_ALLOWED tcp dport 22 accept comment "ssh from office"
        tcp dport { 80, 443 } accept comment "web"

        limit rate 5/minute log prefix "nft-drop: "   # log a sample of blocked traffic
        # falls through to policy drop
    }

    chain forward {
        type filter hook forward priority filter; policy drop;
        # not a router: route nothing
    }

    chain output {
        type filter hook output priority filter; policy accept;
        # allow everything we send
    }
}
```

In plain English: *allow replies, loopback, ping, SSH from the office, and web; drop everything else; route nothing; send anything.*

## Service and safety

```bash
systemctl enable --now nftables     # load /etc/nftables.conf at boot and now
systemctl reload nftables           # reload after editing

# before risky changes over SSH, schedule an auto-undo:
nft list ruleset > /root/good.nft
(sleep 120 && nft -f /root/good.nft) &   # locked out? rules revert in 2 min
nft -f /etc/nftables.conf                # apply; if all is well: kill %1

iptables-translate -A INPUT -p tcp --dport 22 -j ACCEPT   # convert old iptables syntax
```

If your backup file doesn't reset its tables, restoring it on top of existing tables stacks duplicates — add `flush ruleset` to the top of the backup in that case.

## How to build the skill

1. Learn the plumbing: `ip addr`, `ip route`, `ss -tulpn` (what's listening where).
2. Watch real packets: `tcpdump -i eth0 port 22`.
3. Use a throwaway VM — you **will** lock yourself out at least once.
4. Load the minimal config, then add `counter` / `log` and watch which rule matches.
5. Build a two-VM router to experience `forward` and NAT; inspect connections with `conntrack -L`.

If you understand the packet-flow picture and connection tracking, you understand ~80% of nftables. The rest is syntax you can look up.

</div>

<div data-lang="id">

## Apa sebenarnya nftables itu

Firewall di Linux sebenarnya adalah **netfilter**, sebuah framework di dalam kernel. Netfilter memasang titik pemeriksaan yang disebut **hook** di sepanjang jalur yang dilewati paket. **nftables** hanyalah alat untuk memasang aturan (rule) di hook-hook tersebut. (`iptables` adalah alat lama dengan fungsi yang sama tapi sintaksnya lebih ribet.)

Sebelum menulis rule, ada tiga dasar networking yang perlu dipahami:

- **Interface** — cara mesin terhubung ke jaringan: `eth0`, `wlan0`, `lo` (loopback, mesin bicara dengan dirinya sendiri), `wg0` (VPN), `docker0`. Lihat dengan `ip addr`.
- **Paket** — setiap paket punya header IP (**mesin mana**: alamat asal/tujuan) dan header TCP/UDP (**program mana**: port asal/tujuan). Rule firewall pada dasarnya hanya pertanyaan tentang field-field ini.
- **Routing** — untuk setiap paket masuk, kernel bertanya: *"ini untuk saya, atau untuk mesin lain?"* Lihat tabel routing dengan `ip route`.

## Alur paket (gambar paling penting)

```
                                ┌───────────────┐
 paket masuk ─► prerouting ───► │    routing    │ ────► forward ────────────┐
                                │ untuk saya?   │                           │
                                └───────┬───────┘                           ▼
                                        ▼                             postrouting ──► paket keluar
                                      input                                 ▲
                                        ▼                                   │
                                  proses lokal                              │
                                 (sshd, nginx...)                           │
                                        ▼                                   │
                                     output ────────────────────────────────┘
```

Paket hanya bisa melewati tiga jalur:

| Jalur                  | Hook                                     | Penggunaan umum                              |
| ---------------------- | ---------------------------------------- | -------------------------------------------- |
| **Masuk ke mesin ini** | `prerouting` → `input` → program         | Melindungi server ("hanya izinkan SSH + web") |
| **Keluar dari mesin ini** | program → `output` → `postrouting`    | Biasanya dibiarkan terbuka                   |
| **Numpang lewat**      | `prerouting` → `forward` → `postrouting` | Router, server VPN, host Docker              |

Inilah sebabnya firewall server kebanyakan ada di `input`, dan port forwarding (DNAT) ada di `prerouting`: alamat tujuan harus diubah **sebelum** keputusan routing.

## Bentuk setiap config

```
table <family> <nama> {            # folder yang berisi chain
    chain <nama> {                 # daftar rule
        <baris pengaturan>         # menghubungkan chain ke hook (opsional)
        <rule>                     # kondisi ... aksi
    }
}
```

Hanya tiga level: **table → chain → rule**. Setiap baris di dalam chain adalah **baris pengaturan** atau **rule**.

Dua cara bekerja dengan nftables:

- **Perintah** (`nft add ...`) — langsung mengubah ruleset aktif, hilang saat reboot kecuali disimpan.
- **File config** (`nft -f file`) — mendeskripsikan seluruh ruleset sekaligus. Pakai ini untuk yang permanen.

## Melihat dan memuat

```bash
nft list ruleset                 # tampilkan semua yang aktif
nft -a list ruleset              # sama, plus nomor "handle" tiap rule (dibutuhkan untuk hapus)
nft list tables                  # hanya nama-nama table
nft list table inet filter       # satu table: family "inet", nama "filter"
nft list chain inet filter input # satu chain di table tersebut

nft -f /etc/nftables.conf        # muat file config (atomik: semua atau tidak sama sekali)
nft -c -f /etc/nftables.conf     # -c = cek saja: validasi sintaks, tanpa mengubah apa pun
nft list ruleset > backup.nft    # simpan yang aktif (muat ulang dengan nft -f)
nft monitor                      # pantau perubahan rule dan event secara live
```

`-a` = annotate (tampilkan handle), `-c` = check, `-f` = file.

## Table

```bash
nft add table inet filter        # buat table: family "inet", nama "filter" (nama bebas)
nft delete table inet filter     # hapus beserta isinya (error jika tidak ada)
nft destroy table inet filter    # sama, tapi tidak error jika tidak ada (nftables 1.0.8+ / kernel 6.3+)
nft flush table inet filter      # kosongkan rule di semua chain-nya, chain tetap ada
nft flush ruleset                # hapus SEMUA table, termasuk milik Docker dll.
```

**Family** menentukan trafik apa yang dilihat table:

| Family   | Melihat                                                    |
| -------- | ---------------------------------------------------------- |
| `inet`   | IPv4 + IPv6 sekaligus — pakai ini untuk filtering          |
| `ip`     | IPv4 saja — umum untuk table NAT                           |
| `ip6`    | IPv6 saja                                                  |
| `bridge` | trafik yang melewati bridge Linux (layer 2)                |
| `netdev` | sangat awal, per interface (misal drop DDoS di ingress)    |
| `arp`    | paket ARP                                                  |

## Chain dan baris pengaturan

```bash
chain input {
    type filter hook input priority 0; policy drop;
}
```

Dipecah:

```
chain input        # NAMA chain — hanya label, bisa apa saja
type filter        # fungsi chain: filter | nat | route
hook input         # titik pemeriksaan tempat chain dipasang (makna sebenarnya)
priority 0         # urutan antar chain di hook yang sama: lebih kecil jalan duluan
policy drop        # keputusan default jika tidak ada rule yang cocok: accept | drop
;                  # pemisah antar pengaturan
```

Hati-hati: `input` muncul dua kali. Yang pertama hanya **nama**; `hook input` adalah **titik pemeriksaan** yang sebenarnya. `chain satpam { type filter hook input ... }` bekerja persis sama.

Hook:

| Hook          | Posisi                                                     |
| ------------- | ---------------------------------------------------------- |
| `prerouting`  | setiap paket masuk, sebelum "ini untuk saya?"              |
| `input`       | paket yang ditujukan ke mesin ini                          |
| `forward`     | paket yang numpang lewat ke mesin lain                     |
| `output`      | paket yang dibuat oleh mesin ini                           |
| `postrouting` | setiap paket keluar, tepat sebelum pergi                   |
| `ingress`     | (family `netdev`) titik paling awal di sebuah interface    |

Nama priority yang sering muncul:

```
dstnat  = -100   # DNAT di prerouting (jalan sebelum filtering)
filter  =    0   # filtering normal
srcnat  =  100   # SNAT / masquerade di postrouting
```

Chain lewat perintah:

```bash
nft add chain inet filter input '{ type filter hook input priority 0; policy drop; }'
#   │   │     │          │       └─ pengaturan; tanda kutip agar bash tidak memakan { } dan ;
#   │   │     │          └─ nama chain baru
#   │   │     └─ table mana (family + nama)
#   │   └─ apa yang ditambahkan
#   └─ aksinya

nft add chain inet filter my_ssh                   # chain "biasa": tanpa hook, hanya jalan via jump
nft chain inet filter input '{ policy accept; }'   # ubah policy saja
nft flush chain inet filter input                  # hapus semua rule di chain ini
nft delete chain inet filter my_ssh                # hapus chain (harus kosong & tidak dirujuk)
```

## Anatomi sebuah rule

```
[kondisi ...]  [statement ...]  [verdict]
```

Baca seperti kalimat: **jika** semua kondisi cocok, **maka** jalankan statement, lalu verdict.

```bash
ip saddr 10.0.0.5 tcp dport 22 counter accept
# └── kondisi ───┘ └─ kondisi ──┘ └stmt┘ └verdict┘
# "jika asalnya 10.0.0.5 DAN port tujuan TCP adalah 22, hitung, lalu terima"
```

- Beberapa kondisi dalam satu rule = **DAN** (AND).
- Koma / set `{ }` di dalam satu kondisi = **ATAU** (OR).
- Rule dijalankan **dari atas ke bawah**; `accept` atau `drop` pertama mengakhiri chain. Urutan itu penting.

Mengelola rule lewat perintah:

```bash
nft add rule inet filter input tcp dport 22 accept                # tambah di akhir
nft insert rule inet filter input tcp dport 22 accept             # taruh di awal
nft add rule inet filter input position 7 tcp dport 80 accept     # setelah handle 7
nft insert rule inet filter input position 7 tcp dport 80 accept  # sebelum handle 7
nft replace rule inet filter input handle 7 tcp dport 2222 accept # timpa handle 7
nft delete rule inet filter input handle 7                        # hapus (lihat handle dengan -a)
```

## Kondisi (match)

### Alamat

```bash
ip saddr 192.168.1.10          # alamat asal IPv4 ("s" = source)
ip daddr 10.0.0.0/8            # tujuan IPv4 ("d" = destination), /8 = subnet
ip6 saddr 2001:db8::/32        # asal IPv6
ip saddr != 10.0.0.0/8         # != artinya "BUKAN ini"
ip saddr 10.0.0.1-10.0.0.50    # rentang
ip saddr { 1.2.3.4, 5.6.7.8 }  # { } = set anonim: SALAH SATU dari ini
```

### Port dan protokol

```bash
tcp dport 22                   # port tujuan TCP 22
tcp dport { 80, 443 }          # port 80 ATAU 443
tcp dport 8000-8100            # rentang port
udp sport 53                   # port asal UDP 53
meta l4proto { tcp, udp } th dport 53
#    │                    └─ th = "transport header": port untuk tcp ATAU udp
#    └─ l4proto = protokol layer-4
ip protocol icmp               # paket IPv4 yang membawa ICMP
meta l4proto { icmp, ipv6-icmp }   # ICMP untuk IPv4 + IPv6 (pakai di table inet)
icmp type echo-request         # ping IPv4
icmpv6 type echo-request       # ping IPv6
```

### Interface

```bash
iif lo                         # interface masuk (via index) — cepat, untuk interface permanen
oif eth0                       # interface keluar (via index)
iifname "wg0"                  # interface masuk via NAMA — untuk interface yang datang-pergi
oifname "eth0"                 # interface keluar via nama
iifname "docker*"              # wildcard
```

Patokan: `iif` untuk `lo` dan interface tetap, `iifname` untuk VPN, container, dan apa pun yang mungkin belum ada saat rule dimuat.

### Connection tracking (`ct`)

```bash
ct state new                   # paket pertama dari koneksi baru
ct state established           # bagian dari koneksi yang sudah disetujui
ct state related               # baru tapi terkait koneksi yang ada (error ICMP, data FTP)
ct state invalid               # tidak masuk akal — drop saja
ct state established,related   # koma = ATAU
```

Ini kuncinya. Saat kamu menjalankan `curl google.com`, **balasannya** masuk ke mesin dan melewati chain `input`. `ct state established,related accept` meloloskan semua balasan dari koneksi yang sudah disetujui, jadi rule lainnya cukup memutuskan soal koneksi **baru**.

### Info paket lainnya (`meta`)

```bash
meta nfproto ipv4              # hanya paket IPv4 (berguna di table inet)
meta mark 0x1                  # paket membawa mark 1 (diset sebelumnya oleh rule lain)
meta skuid 1000                # (output saja) dikirim oleh proses milik user ID 1000
```

### Singkatan

| Singkatan             | Arti                                                    |
| --------------------- | ------------------------------------------------------- |
| `ct`                  | connection tracking                                     |
| `iif` / `oif`         | interface masuk / keluar (via index)                    |
| `iifname` / `oifname` | interface masuk / keluar (via nama)                     |
| `saddr` / `daddr`     | alamat asal / tujuan                                    |
| `sport` / `dport`     | port asal / tujuan                                      |
| `l4proto`             | protokol layer-4 (tcp, udp, icmp)                       |
| `th`                  | transport header (port untuk tcp atau udp)              |
| `meta`                | info paket di luar header (interface, mark, ...)        |

## Verdict (keputusan akhir)

```bash
accept                         # loloskan (chain ini selesai)
drop                           # buang diam-diam; pengirim tidak dapat balasan
reject                         # buang dan beri tahu pengirim "tidak"
reject with tcp reset          # balas dengan TCP RST ("connection refused")
reject with icmpx type admin-prohibited   # di table inet pakai "icmpx" (v4 + v6)
jump my_ssh                    # jalankan chain my_ssh, lalu kembali
goto my_ssh                    # jalankan chain my_ssh, tidak kembali
return                         # keluar dari chain ini (kembali ke pemanggil, atau pakai policy)
```

## Statement (lakukan sesuatu, lalu lanjut)

```bash
counter                        # hitung paket/byte (lihat dengan nft list ruleset)
log                            # tulis ke log kernel (journalctl -k atau dmesg)
log prefix "SSH-in: "          # tambah label agar mudah di-grep
log prefix "DROP: " level warn # atur tingkat keparahan
limit rate 10/second           # cocok hanya sampai batas ini
limit rate over 10/second      # cocok hanya jika MELEBIHI batas ini
meta mark set 0x1              # beri tanda pada paket
comment "izinkan ssh"          # catatan yang menempel di rule
```

Statement tidak mengakhiri chain, jadi bisa ditumpuk: `counter log prefix "X: " drop`.

## Arti sebenarnya `policy drop`

`policy drop` di `input` = **setiap paket masuk yang tidak di-accept oleh rule mana pun akan di-drop**. Tolak secara default, izinkan sebagai pengecualian — seperti daftar tamu.

- **drop** — dibuang diam-diam. Pengirim menunggu sampai timeout. Tidak membocorkan info apa pun.
- **reject** — dibuang dan dibalas "tidak". Pengirim langsung dapat "connection refused".

Policy hanya bisa `accept` atau `drop`. Untuk perilaku reject, tambahkan sebagai rule terakhir:

```bash
chain input {
    type filter hook input priority 0; policy drop;
    ct state established,related accept
    iif lo accept
    tcp dport 22 accept
    reject          # sisanya dapat "tidak" yang sopan
}
```

Simulasi paket:

- SSH ke port 22 → cocok `tcp dport 22 accept` → **masuk**.
- Seseorang mencoba port 3306 → tidak cocok apa pun → **di-drop** oleh policy.
- Balasan dari `curl google.com` → cocok `ct state established` → **masuk**.
- Aplikasi lokal bicara ke `127.0.0.1` → cocok `iif lo accept` → **masuk**.

Lupa baris `ct state` → apt, DNS, dan semua balasan rusak. Lupa `iif lo` → software lokal rusak. Lupa port 22 → kamu terkunci di luar.

## Chain forward

```bash
chain forward {
    type filter hook forward priority 0; policy drop;
}
```

Tanpa rule + `policy drop` = **jangan pernah meneruskan trafik orang lain**. Tepat untuk server atau desktop biasa. Linux juga tidak akan melakukan routing kecuali forwarding diaktifkan:

```bash
sysctl net.ipv4.ip_forward       # 0 = mati (default), 1 = hidup
```

Saat mesin **memang** router (`eth0` = internet, `eth1` = LAN):

```bash
chain forward {
    type filter hook forward priority 0; policy drop;
    ct state established,related accept     # balasan dari koneksi yang disetujui
    iifname "eth1" oifname "eth0" accept     # LAN → internet diizinkan
}                                            # internet → LAN di-drop
```

Server VPN: `iifname "wg0" oifname "eth0" accept`.

**Jebakan Docker:** Docker mengaktifkan forwarding dan menambahkan chain-nya sendiri. `drop` di chain **mana pun** pada sebuah hook bersifat final, jadi `policy drop` milikmu di forward bisa memutus container walaupun chain Docker sudah meng-accept-nya. Izinkan interface Docker (misal `iifname "docker0" accept`, `oifname "docker0" accept`) dan jangan `flush ruleset` di host Docker.

## Set (daftar yang bisa diubah secara live)

```bash
table inet filter {
    set blocklist {
        type ipv4_addr             # isi set
        flags interval             # izinkan rentang/subnet
        elements = { 10.0.0.0/8, 203.0.113.7 }
    }

    set temp_ban {
        type ipv4_addr
        flags timeout              # elemen bisa kedaluwarsa
        timeout 1h                 # masa berlaku default
    }

    chain input {
        type filter hook input priority 0; policy drop;
        ip saddr @blocklist drop   # @nama = "apakah ada di set ini?"
        ip saddr @temp_ban drop
    }
}
```

```bash
nft add element inet filter blocklist '{ 198.51.100.0/24 }'     # tambah
nft delete element inet filter blocklist '{ 203.0.113.7 }'      # hapus
nft add element inet filter temp_ban '{ 1.2.3.4 timeout 10m }'  # tambah dengan masa berlaku
nft list set inet filter blocklist                              # lihat isi
```

Tipe set: `ipv4_addr`, `ipv6_addr`, `inet_service` (port), `ifname`, `ether_addr` (MAC).

## Map (tabel lookup)

```bash
tcp dport vmap { 22 : accept, 23 : drop, 80 : jump web }
# vmap = verdict map: cari port, terapkan verdict di sebelahnya

dnat to tcp dport map { 80 : 192.168.1.10, 443 : 192.168.1.11 }
# map = cari port, pakai hasilnya sebagai tujuan NAT
```

## Membatasi brute force (per IP)

```bash
table inet filter {
    set ssh_meter {
        type ipv4_addr
        flags dynamic              # rule bisa menambah entri secara otomatis
        timeout 1m                 # lupakan IP setelah 1 menit diam
    }
    chain input {
        type filter hook input priority 0; policy drop;
        ct state established,related accept
        tcp dport 22 ct state new update @ssh_meter { ip saddr limit rate over 3/minute } drop
        # "jika satu IP membuka lebih dari 3 koneksi SSH baru per menit, drop"
        tcp dport 22 accept
    }
}
```

## NAT

```bash
table ip nat {                                     # family "ip": paling simpel untuk NAT IPv4
    chain prerouting {
        type nat hook prerouting priority dstnat;
        iifname "eth0" tcp dport 8080 dnat to 192.168.1.10:80
        # DNAT = ubah TUJUAN: publik :8080 → server internal :80
        tcp dport 80 redirect to :3128
        # redirect = DNAT ke mesin ini sendiri (misal proxy lokal)
    }
    chain postrouting {
        type nat hook postrouting priority srcnat;
        oifname "eth0" masquerade
        # masquerade = ubah ASAL jadi IP eth0 saat ini (IP dinamis)
        oifname "eth1" snat to 203.0.113.10
        # SNAT = ubah ASAL jadi IP tetap (IP statis)
    }
}
```

Di table `inet`, sebutkan versi IP-nya: `dnat ip to 192.168.1.10:80`. NAT yang di-routing juga butuh `sysctl -w net.ipv4.ip_forward=1` plus rule di chain forward.

## Variabel dan include

```bash
define LAN = 192.168.1.0/24        # definisikan variabel
define WEB_PORTS = { 80, 443 }     # bisa berisi set

ip saddr $LAN accept               # $ = pakai variabel
tcp dport $WEB_PORTS accept

include "/etc/nftables.d/*.nft"    # pecah config besar jadi beberapa file
```

## Flush atau tidak

nftables tidak pernah flush sendiri:

- Perintah `nft add ...` **menambahkan** ke yang sudah ada.
- `nft -f file` menjalankan isi file. Tanpa `flush` di dalamnya = rule **menumpuk** (dimuat dua kali → duplikat).

`flush ruleset` di awal file menjadikan file itu satu-satunya sumber kebenaran, dan karena `nft -f` bersifat atomik, tidak pernah ada momen tanpa firewall. Tapi perintah ini menghapus **semua** table — Docker, libvirt, fail2ban, Tailscale, Kubernetes. Di mesin yang dipakai bersama, reset table milikmu saja:

```bash
# nftables 1.0.8+
destroy table inet myfw
table inet myfw { ... }

# versi lama — idiom buat-lalu-hapus (delete error jika table tidak ada)
table inet myfw
delete table inet myfw
table inet myfw { ... }
```

Patokan: mesin khusus tanpa tool lain yang mengatur firewall → `flush ruleset` aman. Ada tool lain yang mengatur networking → reset table milikmu saja.

## Contoh config server lengkap dengan anotasi

```bash
#!/usr/sbin/nft -f

define SSH_ALLOWED = { 203.0.113.0/24 }        # siapa yang boleh SSH (sesuaikan!)

table inet myfw                                 # reset table kita saja
delete table inet myfw

table inet myfw {
    chain input {
        type filter hook input priority filter; policy drop;

        ct state invalid drop                   # paket sampah: tolak
        ct state established,related accept     # balasan koneksi kita: terima
        iif lo accept                           # mesin bicara ke dirinya sendiri: terima

        meta l4proto { icmp, ipv6-icmp } accept # ping & ICMP (IPv6 rusak tanpa ICMPv6)

        ip saddr $SSH_ALLOWED tcp dport 22 accept comment "ssh dari kantor"
        tcp dport { 80, 443 } accept comment "web"

        limit rate 5/minute log prefix "nft-drop: "   # log sebagian trafik yang diblokir
        # sisanya jatuh ke policy drop
    }

    chain forward {
        type filter hook forward priority filter; policy drop;
        # bukan router: jangan teruskan apa pun
    }

    chain output {
        type filter hook output priority filter; policy accept;
        # izinkan semua yang kita kirim
    }
}
```

Dalam bahasa sehari-hari: *izinkan balasan, loopback, ping, SSH dari kantor, dan web; drop sisanya; jangan meneruskan apa pun; kirim apa saja.*

## Service dan keamanan

```bash
systemctl enable --now nftables     # muat /etc/nftables.conf saat boot dan sekarang
systemctl reload nftables           # muat ulang setelah mengedit

# sebelum perubahan berisiko lewat SSH, jadwalkan pembatalan otomatis:
nft list ruleset > /root/good.nft
(sleep 120 && nft -f /root/good.nft) &   # terkunci? rule kembali dalam 2 menit
nft -f /etc/nftables.conf                # terapkan; jika aman: kill %1

iptables-translate -A INPUT -p tcp --dport 22 -j ACCEPT   # konversi sintaks iptables lama
```

Jika file backup tidak me-reset table-nya, memulihkannya di atas table yang sudah ada akan membuat duplikat — tambahkan `flush ruleset` di awal file backup untuk kasus itu.

## Cara membangun kemampuan ini

1. Pahami dasarnya: `ip addr`, `ip route`, `ss -tulpn` (apa yang listen di mana).
2. Lihat paket nyata: `tcpdump -i eth0 port 22`.
3. Pakai VM sekali pakai — kamu **pasti** pernah terkunci di luar setidaknya sekali.
4. Muat config minimal, lalu tambahkan `counter` / `log` dan amati rule mana yang cocok.
5. Buat router dengan dua VM untuk merasakan `forward` dan NAT; periksa koneksi dengan `conntrack -L`.

Jika kamu paham gambar alur paket dan connection tracking, kamu sudah paham ~80% nftables. Sisanya hanya sintaks yang bisa dicari kapan saja.

</div>
