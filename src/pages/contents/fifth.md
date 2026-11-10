---
layout: ../../layouts/ContentLayout.astro
title: "Model OSI: Tujuh Lapisan Jaringan dan Letaknya di Linux"
title_en: "The OSI Model: Seven Network Layers and Where Linux Runs Each One"
description: Tujuh lapisan OSI dari kabel sampai aplikasi. Apa kerja tiap lapisan, kapan kamu berurusan dengannya, simulasi interaktif, dan bagian mana yang dijalankan kernel Linux, user space, atau hardware.
description_en: The seven OSI layers from the cable to the application. What each layer does, when you deal with it, an interactive simulation, and which part Linux runs in the kernel, in user space, or in hardware.
date: 2026-11-10
tags:
  - linux
  - networking
  - osi
  - kernel
  - notes
---

<div data-lang="en" hidden>

## What the OSI model is

The OSI model (Open Systems Interconnection) is a reference model that ISO published in 1984. It splits network communication into seven layers. Each layer does one job and only talks to the layer directly above and below it.

The internet does not run OSI protocols. It runs the TCP/IP suite, which has four layers. People still use the OSI numbers every day. "L2 switch", "L4 load balancer", and "L7 firewall" all refer to OSI layers. When someone says "it's an L3 problem", they mean routing or IP addresses.

A mnemonic for the order, from layer 1 up: **P**lease **D**o **N**ot **T**hrow **S**ausage **P**izza **A**way.

## The seven layers at a glance

| # | Layer        | Unit of data  | Address       | Examples                          | Device                 | Who runs it in Linux            |
| - | ------------ | ------------- | ------------- | --------------------------------- | ---------------------- | ------------------------------- |
| 7 | Application  | message       | URL, hostname | HTTP, DNS, SSH, SMTP              | L7 proxy, WAF          | your program (nginx, curl, sshd) |
| 6 | Presentation | message       | none          | TLS encryption, UTF-8, JSON, gzip | none                   | libraries in your program (OpenSSL, zlib) |
| 5 | Session      | message       | session ID    | TLS sessions, HTTP/2 streams, RPC | none                   | libraries in your program        |
| 4 | Transport    | segment (TCP), datagram (UDP) | port | TCP, UDP                   | L4 load balancer, stateful firewall | kernel (TCP, UDP, sockets) |
| 3 | Network      | packet        | IP address    | IPv4, IPv6, ICMP                  | router                 | kernel (routing, netfilter)      |
| 2 | Data link    | frame         | MAC address   | Ethernet, Wi-Fi, VLAN, ARP        | switch, access point   | kernel and driver (bridge, ARP)  |
| 1 | Physical     | bit           | none          | copper, fiber, radio              | cable, hub, repeater   | network card hardware            |

## OSI and TCP/IP side by side

```
 OSI model            TCP/IP model        what actually runs
 ───────────────      ──────────────      ──────────────────────────────
 7 Application   ┐
 6 Presentation  ├──► Application         HTTP, DNS, SSH, TLS, JSON
 5 Session       ┘
 4 Transport     ───► Transport           TCP, UDP
 3 Network       ───► Internet            IP, ICMP
 2 Data link     ┐
 1 Physical      ┴──► Link                Ethernet, Wi-Fi, ARP
```

TCP/IP merges layers 5, 6, and 7 into one application layer, because in practice one program does all three. It also merges layers 1 and 2, because one network card does both.

Some protocols do not fit one layer. TLS encrypts data (layer 6), keeps session state (layer 5), and runs inside the application process (layer 7). ARP turns IP addresses (layer 3) into MAC addresses (layer 2). Use the model to locate a problem, and do not argue about where a protocol "really" belongs.

## Encapsulation: how the layers stack

When a program sends data, each layer going down adds its own header in front. The receiving machine removes them going up, in reverse order.

```
 L7  Application                            [ GET / HTTP/1.1 ]
 L6  Presentation                   [ TLS │ encrypted HTTP ]
 L5  Session                        (same bytes, inside an open TLS session)
 L4  Transport                [ TCP │ TLS │ encrypted HTTP ]
 L3  Network             [ IP │ TCP │ TLS │ encrypted HTTP ]
 L2  Data link    [ ETH │ IP │ TCP │ TLS │ encrypted HTTP │ FCS ]
 L1  Physical     10110001011101001010101110101001010...
```

Each layer only reads its own header and treats the rest as payload. A switch reads the Ethernet header and nothing else. A router reads the IP header. Only the receiving program reads the HTTP request. This is why you can change Wi-Fi to Ethernet (layer 1 and 2) without changing your browser (layer 7).

## Simulation

Pick a scenario and step through it. The two stacks are the sending and receiving machines, the middle column shows the devices in between, and the bar at the bottom shows the packet as it looks at that moment. Each colored block is one layer's header.

<div class="osi-sim" data-sim-lang="en"></div>

Things to notice:

- In the HTTPS scenario, the switch only reads the Ethernet header, and the router only reads up to the IP header. Neither can see the HTTP request, because TLS encrypted it at layer 6.
- The router builds a new Ethernet header for the next link. MAC addresses change at every hop, and the IP addresses stay the same (except where NAT rewrites them).
- In the ping scenario, nothing above layer 3 runs. The router's kernel answers by itself. A working ping proves layers 1 to 3 and nothing else.
- In the DNS scenario, UDP sends the question in the first packet with no handshake. If it is lost, the kernel does not resend it. The resolver program retries.

## Where each layer runs in Linux

```
            ┌───────────────────────────────────────────┐
 L7         │ your program: nginx, curl, sshd, browser  │
 L6         │ libraries: OpenSSL, zlib, JSON parser     │   user space
 L5         │ TLS session, HTTP/2 streams               │
            ├──────── socket API (system calls) ────────┤ ◄── socket(), connect(), read(), write()
 L4         │ TCP, UDP                                  │
 L3         │ IP, routing table, netfilter (nftables)   │   kernel
 L2         │ ARP, bridges, VLANs, qdisc, driver        │
            ├───────────────────────────────────────────┤
 L1 (+L2)   │ network card: PHY, MAC, checksum, DMA     │   hardware
            └───────────────────────────────────────────┘
```

The socket API is the line between the layers. Everything at layer 4 and below runs in the kernel and the network card. Everything at layer 5 and above runs inside your program. Your program never builds an IP or TCP header. It calls `write()` on a socket, and the kernel does layers 4 to 2.

This split explains a few everyday Linux facts:

- Changing routes, firewall rules, or interfaces needs root, because those live in the kernel. Running a web server on port 8080 does not.
- Ports below 1024 need root or `CAP_NET_BIND_SERVICE`. The kernel enforces this at layer 4 (`net.ipv4.ip_unprivileged_port_start = 1024`).
- `ping` works without root on modern distributions, because the kernel offers unprivileged ICMP sockets (`net.ipv4.ping_group_range`).
- A Docker container shares the host kernel, so it shares layers 2 to 4 code. It gets its own interfaces, routes, and sockets through a network namespace.

Some tools move work across the line:

| Tool       | What it moves                                                         |
| ---------- | --------------------------------------------------------------------- |
| kTLS       | TLS encryption (layer 6) into the kernel, so nginx can `sendfile()` over HTTPS. Load with `modprobe tls`. |
| QUIC       | Reliable delivery (layer 4 work) into the program, on top of UDP. HTTP/3 uses it. |
| TUN / TAP  | A virtual interface that hands layer 3 packets (TUN) or layer 2 frames (TAP) to a program. VPNs such as OpenVPN and Tailscale use TUN. |
| XDP / eBPF | Small programs that run in the driver before the kernel's layer 2 and 3 code, used for fast packet filtering. |
| DPDK       | The program takes over the network card and runs layers 2 to 4 itself, for very high packet rates. |

Other operating systems split the work the same way with different names:

| Layer        | Linux                       | Windows                       | macOS                              |
| ------------ | --------------------------- | ----------------------------- | ---------------------------------- |
| L1, L2       | driver (`r8169`, `iwlwifi`) | NDIS miniport driver          | DriverKit / IOKit driver           |
| L3, L4       | kernel net stack            | `tcpip.sys`                   | XNU kernel, BSD-derived stack      |
| boundary     | BSD sockets                 | Winsock                       | BSD sockets, Network.framework     |
| L6 (TLS)     | OpenSSL, GnuTLS, kTLS       | Schannel                      | Network.framework                  |
| L7           | your program                | your program                  | your program                       |

The protocols on the wire are the same everywhere, so a Windows laptop and a Linux server talk without any special handling.

## Layer by layer

### Layer 1: Physical

Layer 1 moves raw bits as voltage on copper, light in fiber, or radio waves. It knows nothing about addresses. It decides link speed (100 Mbit/s, 1 Gbit/s, 10 Gbit/s), duplex, connectors, and cable types.

The network card does this work. Linux only reads the result through the driver.

```bash
ip -br link                               # UP, DOWN, or NO-CARRIER for each interface
cat /sys/class/net/enp4s0/carrier         # 1 = cable plugged in and link up
cat /sys/class/net/enp4s0/speed           # 1000 = 1 Gbit/s
sudo ethtool enp4s0                       # speed, duplex, "Link detected: yes"
ip -s link show enp4s0                    # packet, error, and drop counters
dmesg -T | grep -i 'link is'              # "Link is Up - 1Gbps/Full"
iw dev wlan0 link                         # Wi-Fi signal strength and bitrate
```

```
$ ip -s link show enp4s0
3: enp4s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:2b:67:61:2c:81 brd ff:ff:ff:ff:ff:ff
    RX:  bytes packets errors dropped  missed   mcast
     342006120  446999      0     386       0    6821
    TX:  bytes packets errors dropped carrier collsns
     191352187  347042      0       0       0       0
```

`LOWER_UP` means the card sees a link. `UP` alone only means someone ran `ip link set up`.

You work at layer 1 when:

- `ip link` shows `NO-CARRIER`. The cable is unplugged, broken, or the switch port is off.
- The link runs at 100 Mbit/s instead of 1 Gbit/s. One pair in the cable is often damaged.
- `errors` keeps growing in `ip -s link`. Bad cable, bad port, or interference.
- Wi-Fi is slow and `iw` shows a weak signal (worse than about -70 dBm).

### Layer 2: Data link

Layer 2 moves frames between machines on the same local network, meaning the same switch or the same Wi-Fi. The address is the 48-bit MAC address burned into each network card.

An Ethernet frame has a destination MAC, a source MAC, a type field (`0x0800` for IPv4, `0x86DD` for IPv6, `0x0806` for ARP), the payload, and a 4-byte checksum (FCS) at the end. The largest payload is the MTU, usually 1500 bytes.

A switch learns which MAC address sits behind which port and sends each frame only to that port. ARP finds the MAC address for an IP address on the local network. A machine broadcasts "who has 192.168.1.1?" and the owner replies with its MAC. VLANs (802.1Q) add a tag to the frame so one physical switch acts as several separate ones.

In Linux, the driver and the kernel do layer 2. The kernel keeps the ARP table, and it can act as a switch. `docker0` and every `br-*` interface is a software switch (a bridge), and each container is plugged into one with a `veth` pair.

```bash
ip link show enp4s0                     # link/ether = your MAC, mtu = largest payload
ip neigh                                # ARP table: IP to MAC for machines on your LAN
sudo arping -I enp4s0 192.168.1.1       # send ARP requests directly
sudo tcpdump -eni enp4s0 arp            # -e prints MAC addresses
bridge link                             # which interfaces are plugged into which bridge
ip -d link show docker0                 # -d shows it is a bridge
sudo ip link add link enp4s0 name enp4s0.10 type vlan id 10   # VLAN 10 on top of enp4s0
```

```
$ ip neigh
192.168.1.1 dev enp4s0 lladdr d8:9a:0d:80:8f:f9 REACHABLE
172.19.0.2 dev br-68d019f1085b lladdr 06:79:9a:ff:17:c3 REACHABLE
172.22.0.2 dev br-3325c98c3499 lladdr f6:49:01:ca:f3:93 STALE
```

The first line is the home router. The other two are Docker containers behind software bridges.

You work at layer 2 when:

- `ip neigh` shows `FAILED` or `INCOMPLETE` for your gateway. You can reach nothing outside the LAN.
- Two machines have the same IP. ARP answers flip between two MACs, and connections drop at random.
- Small packets work but large ones hang. SSH logs in, then freezes on `ls` of a big directory. The MTU is smaller somewhere on the path, often a VPN or tunnel.
- You plug a cable into two ports of the same switch and the network dies. That loop makes broadcasts circle forever, unless the switch runs Spanning Tree.

### Layer 3: Network

Layer 3 moves packets between networks, across the whole internet, one router at a time. The address is the IP address plus a subnet mask, which says which addresses are local.

Every router reads the destination IP, looks it up in its routing table, and sends the packet to the next router. Each router lowers the TTL (time to live) by one. When TTL reaches 0, the router drops the packet and sends back an ICMP "time exceeded" message. `traceroute` uses this to find every router on the path. ICMP also carries `ping` and error messages such as "destination unreachable". Your home router also does NAT. It rewrites your private source address (`192.168.x.x`) into its one public address.

In Linux, the kernel does layer 3. It owns the routing table, decides whether a packet is for this machine or should be forwarded, and runs netfilter hooks where nftables rules apply.

```bash
ip -br addr                             # IP addresses on each interface
ip route                                # routing table
ip route get 1.1.1.1                    # the route, interface, and source IP the kernel would use
ping -c 3 192.168.1.1                   # ICMP echo: does layer 3 reach that host?
tracepath -n 1.1.1.1                    # every router on the path, plus the path MTU
mtr -n 1.1.1.1                          # live traceroute with packet loss per hop
sysctl net.ipv4.ip_forward              # 1 = this machine routes packets for others
sudo nft list ruleset                   # firewall rules on the layer 3 hooks
```

```
$ ip route get 1.1.1.1
1.1.1.1 via 192.168.1.1 dev enp4s0 src 192.168.1.6 uid 1000

$ tracepath -n 1.1.1.1
 1?: [LOCALHOST]                      pmtu 1500
 1:  192.168.1.1                                           0.655ms
 2:  10.89.192.1                                           6.320ms
 3:  no reply
 4:  162.158.43.14                                         3.588ms
```

You work at layer 3 when:

- You get `Network is unreachable`. The kernel has no route for that address. Check `ip route` for a `default via` line.
- You get `No route to host`. A route exists, but the host did not answer ARP, or a router or firewall sent back ICMP "unreachable".
- The LAN works and the internet does not. The default gateway is wrong or down.
- A Linux box should route (a VPN server, a Docker host, a router) and does not. `ip_forward` is 0, or the firewall's `forward` chain drops the traffic.
- `ping` works but the service does not. Layer 3 is fine. Move up to layer 4.

### Layer 4: Transport

Layer 4 moves data between programs. IP gets a packet to the right machine. The port number gets it to the right program on that machine. Four values identify a connection: source IP, source port, destination IP, and destination port.

There are two main protocols.

TCP gives a reliable, ordered byte stream. It opens a connection with a three-way handshake, numbers every byte, waits for acknowledgments, resends what is lost, and slows down when the network or the receiver is full.

```
 client                                 server (listening on port 443)
   │ ── SYN ─────────────────────────────► │
   │ ◄──────────────────────────── SYN+ACK │
   │ ── ACK ─────────────────────────────► │   connection open, data can flow
```

UDP sends independent datagrams. It has no handshake, no ordering, and no resending. Its header is 8 bytes. A lost datagram is gone unless the program sends it again.

| Use TCP when                                    | Use UDP when                                     |
| ----------------------------------------------- | ------------------------------------------------ |
| Every byte matters: web pages, files, APIs, SSH | Late data is useless: voice and video calls, games |
| Order matters: database queries                 | Messages are small and independent: DNS, NTP, DHCP |
| You want the kernel to handle resending         | You handle reliability yourself, as QUIC does    |

HTTP/3 runs on QUIC, which runs on UDP. QUIC does the layer 4 work inside the browser, so one lost packet only stalls one stream instead of the whole connection.

In Linux, the kernel runs TCP and UDP. Your program only sees a socket, which is a file descriptor.

```bash
ss -tulpn                               # listening TCP and UDP ports and their processes
ss -tan state established               # open TCP connections
ss -ti                                  # per-connection details: rtt, congestion window, retransmits
nc -zv example.com 443                  # can a TCP connection to this port be opened?
sudo tcpdump -ni any 'tcp[tcpflags] & tcp-syn != 0'   # only connection attempts
nstat -az | grep -i retrans             # kernel retransmission counters
```

```
$ ss -tlnp
State  Recv-Q Send-Q   Local Address:Port  Peer Address:Port
LISTEN 0      4096     127.0.0.53%lo:53         0.0.0.0:*
LISTEN 0      4096           0.0.0.0:4000       0.0.0.0:*
```

`127.0.0.53:53` is systemd-resolved, the local DNS cache. It listens on loopback only, so other machines cannot reach it. `0.0.0.0:4000` accepts connections on every interface.

You work at layer 4 when:

- You get `Connection refused`. The host is up, but nothing listens on that port and the kernel answered with RST. Check `ss -tlnp`.
- The connection hangs and then times out. Something drops the packets, usually a firewall. A refusal fails in milliseconds and a timeout takes seconds or minutes.
- The service works on the server itself but not from outside. It listens on `127.0.0.1` instead of `0.0.0.0`.
- You get `Address already in use`. Another process holds the port.
- The `CLOSE-WAIT` count keeps growing in `ss -tan`. Your program does not call `close()` on sockets the other side has closed.

### Layer 5: Session

Layer 5 opens, keeps, resumes, and closes a conversation between two programs. TCP/IP has no separate session layer. Programs and libraries do this work themselves, so this layer is the hardest to point at.

Real examples:

- TLS session resumption. A client that reconnects can reuse keys from an earlier session and skip most of the handshake.
- HTTP/2 and HTTP/3 run many request streams inside one connection.
- HTTP keep-alive and connection pools reuse one TCP connection for many requests.
- SSH multiplexing (`ControlMaster`) runs many `ssh` and `scp` commands over one open SSH session.
- RPC frameworks, SOCKS proxies, and SMB file sharing keep their own sessions.

A login cookie is also called a "session", but it belongs to the application at layer 7.

In Linux, layer 5 runs in user space, inside your program or its libraries.

```bash
openssl s_client -connect example.com:443 -tls1_2 -reconnect </dev/null 2>/dev/null | grep -E '^(New|Reused)'
# New, TLSv1.2, Cipher is ECDHE-ECDSA-CHACHA20-POLY1305       ← first connection: full handshake
# Reused, TLSv1.2, Cipher is ECDHE-ECDSA-CHACHA20-POLY1305    ← reconnects resume the session

curl -sv -o /dev/null -o /dev/null https://example.com/ https://example.com/ 2>&1 | grep -i 're-using'
# * Re-using existing connection with host example.com        ← second request, no new handshake

ssh -O check prod                       # is a shared SSH session open?
```

You work at layer 5 when:

- Every request pays for a new TCP and TLS handshake because the client does not reuse connections.
- A load balancer sends each request of one session to a different backend. That needs "sticky sessions" or shared session storage.
- Long-lived connections (WebSockets, database pools) die after an idle timeout on a proxy or NAT.

### Layer 6: Presentation

Layer 6 makes sure both sides read the bytes the same way. It covers encoding (UTF-8), serialization (JSON, Protocol Buffers), compression (gzip, Brotli), and encryption (TLS).

In Linux, layer 6 also runs in user space, in libraries such as OpenSSL, zlib, and JSON parsers inside your program. The exception is kTLS, where the kernel encrypts the TLS records after the program finished the handshake.

```bash
openssl s_client -connect example.com:443 -servername example.com -brief </dev/null
printf 'é' | od -An -tx1                 # c3 a9: the letter é as UTF-8 bytes
printf '\xc3\xa9' | iconv -f latin1 -t utf-8   # Ã©: the same bytes read as Latin-1
file data.bin                            # guess a file's format from its bytes
curl -s --compressed -o /dev/null -w '%{size_download}\n' https://example.com
```

```
$ openssl s_client -connect example.com:443 -servername example.com -brief </dev/null
CONNECTION ESTABLISHED
Protocol version: TLSv1.3
Ciphersuite: TLS_AES_256_GCM_SHA384
Peer certificate: CN = example.com
Verification: OK
```

You work at layer 6 when:

- Text shows `Ã©` instead of `é`. One side wrote UTF-8 and the other read Latin-1.
- TLS fails with `certificate has expired` or a hostname mismatch.
- You see `wrong version number` from OpenSSL. The client speaks TLS to a port that speaks plain HTTP.
- An API returns `415 Unsupported Media Type`. You sent form data where it expects JSON.

### Layer 7: Application

Layer 7 is the protocol your program speaks: HTTP, DNS, SSH, SMTP, IMAP, MQTT, the PostgreSQL wire protocol. Addresses here are hostnames, URLs, paths, and email addresses.

In Linux, layer 7 is ordinary programs and daemons: nginx, sshd, postfix, and systemd-resolved for DNS.

```bash
curl -v https://example.com             # DNS, TCP connect, TLS, then the HTTP request and response
dig example.com                         # DNS question and answer
resolvectl status                       # which DNS servers systemd-resolved uses
ssh -v user@host                        # SSH negotiation step by step
journalctl -u nginx -n 50               # logs of a layer 7 service
```

`curl -v` walks through several layers in one command:

```
* Host example.com:443 was resolved.                       ← L7: DNS answered
* Connected to example.com (172.66.147.243) port 443       ← L3 and L4: route found, TCP handshake done
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384    ← L5 and L6: TLS session and encryption
* ALPN: server accepted h2                                 ← both sides agree to speak HTTP/2
> GET / HTTP/2                                             ← L7: request
< HTTP/2 200                                               ← L7: response
```

You work at layer 7 when:

- `Could not resolve host`. DNS failed. Check `resolvectl status` and `dig`.
- HTTP returns 4xx or 5xx. A `502 Bad Gateway` means the proxy reached layer 4 of its backend but got no valid HTTP back.
- The wrong site answers. The `Host` header or the TLS SNI name does not match the server's configuration.

## Devices, and the layer they work at

| Layer | Devices and software                                                   | Linux equivalent                      |
| ----- | ---------------------------------------------------------------------- | ------------------------------------- |
| 1     | cable, hub, repeater, media converter                                  | none                                  |
| 2     | switch, access point, bridge                                           | `ip link add br0 type bridge`         |
| 3     | router, layer 3 switch                                                 | `sysctl net.ipv4.ip_forward=1`        |
| 3, 4  | stateful firewall, cloud security group, NAT                           | nftables                              |
| 4     | L4 load balancer (AWS NLB, IPVS)                                       | `ipvsadm`, HAProxy in `mode tcp`      |
| 7     | reverse proxy, L7 load balancer (AWS ALB), WAF, API gateway            | nginx, HAProxy in `mode http`, Envoy  |

One Linux machine can do all of these at once. A typical Docker host is a switch (bridges), a router (`ip_forward`), a firewall and NAT (nftables), and often a reverse proxy (nginx) too.

### L4 or L7 load balancing

This is one of the most common real decisions that uses OSI numbers.

| L4 load balancer                                     | L7 load balancer                                      |
| ---------------------------------------------------- | ----------------------------------------------------- |
| Sees IP addresses and ports only                     | Reads the full HTTP request                           |
| Works for any TCP or UDP protocol: databases, MQTT, game servers | Works for HTTP, gRPC, WebSocket              |
| Passes TLS through, the backend holds the certificate | Ends TLS, the load balancer holds the certificate    |
| Cannot route by URL, header, or cookie               | Routes by host, path, header, or cookie               |
| Very little CPU per connection                       | More CPU, but can retry, cache, compress, and add headers |

Pick L4 for non-HTTP traffic, or when the backend must see the original TLS connection. Pick L7 when you need path-based routing (`/api` to one service, `/` to another), one certificate for many backends, or HTTP-level retries and logs.

## Troubleshoot from the bottom up

When something does not connect, check the layers in order from 1 to 7. Stop at the first one that fails. A problem at a lower layer breaks everything above it.

```bash
ip -br link                                        # L1: is the interface UP with LOWER_UP?
ip neigh show 192.168.1.1                          # L2: does the gateway answer ARP (REACHABLE)?
ip route get 1.1.1.1 && ping -c 2 1.1.1.1          # L3: is there a route, and do packets come back?
nc -zv example.com 443                             # L4: can a TCP connection open?
openssl s_client -connect example.com:443 -brief </dev/null   # L5, L6: does TLS work?
curl -v https://example.com                        # L7: does the application answer?
```

`curl -v` alone often shows which layer stopped, because it prints each stage before it fails.

Common error messages and their layer:

| Message                                   | Layer | Meaning                                              |
| ----------------------------------------- | ----- | ---------------------------------------------------- |
| `NO-CARRIER` in `ip link`                 | 1     | No physical link.                                    |
| `FAILED` in `ip neigh`                    | 2     | The host does not answer ARP.                        |
| `Network is unreachable`                  | 3     | No route for that address.                           |
| `No route to host`                        | 3     | Host does not answer ARP, or a firewall rejected with ICMP. |
| `Connection timed out`                    | 3 or 4 | Packets are dropped somewhere on the path.          |
| `Connection refused`                      | 4     | Nothing listens on that port.                        |
| `wrong version number`                    | 6     | TLS client talking to a non-TLS port.                |
| `certificate has expired`                 | 6     | Certificate problem.                                 |
| `Could not resolve host`                  | 7     | DNS lookup failed.                                   |
| `502 Bad Gateway`                         | 7     | The proxy got no valid answer from its backend.      |

## See layers 2 to 4 in one capture

`tcpdump -e` prints the Ethernet header too, so one line shows three layers at once:

```bash
sudo tcpdump -eni enp4s0 -c 3 'tcp port 443'      # terminal 1
curl -s -o /dev/null https://example.com          # terminal 2
```

```
00:2b:67:61:2c:81 > d8:9a:0d:80:8f:f9, ethertype IPv4 (0x0800), length 74: 192.168.1.6.51234 > 172.66.147.243.443: Flags [S], seq 3542141823, win 64240, length 0
└──────── L2: MAC addresses ────────┘  └───── L2: type ──────┘             └──────── L3: IPs, L4: ports ────────┘  └ L4: flags ┘
```

This line is shortened, and your ports and numbers will differ. The destination MAC is the router's (`d8:9a:0d:80:8f:f9` from `ip neigh`), while the destination IP is the web server's. Your machine sends the frame to the router at layer 2 and addresses the packet to the server at layer 3. Layer 7 is encrypted, so `tcpdump` cannot show the HTTP request.

## Summary

1. OSI has seven layers. TCP/IP, which the internet runs, has four. People use the OSI numbers anyway.
2. Each layer adds a header on the way down and removes it on the way up. Each device reads only the layers it needs.
3. In Linux, the network card does layer 1. The kernel does layers 2 to 4. Your program does layers 5 to 7. The socket API is the line between the kernel and your program.
4. MAC addresses change at every hop. IP addresses stay the same end to end, except where NAT rewrites them.
5. Troubleshoot from layer 1 up. `ping` only proves layer 3, `nc -z` proves layer 4, and `curl -v` shows all of them.

</div>

<div data-lang="id">

## Apa itu model OSI

Model OSI (Open Systems Interconnection) adalah model referensi yang diterbitkan ISO pada 1984. Model ini membagi komunikasi jaringan menjadi tujuh lapisan. Tiap lapisan mengerjakan satu tugas dan hanya berhubungan dengan lapisan tepat di atas dan di bawahnya.

Internet tidak menjalankan protokol OSI. Internet menjalankan rangkaian TCP/IP, yang punya empat lapisan. Walaupun begitu, nomor lapisan OSI tetap dipakai setiap hari. "Switch L2", "load balancer L4", dan "firewall L7" semuanya merujuk ke lapisan OSI. Kalau ada yang bilang "ini masalah L3", maksudnya masalah routing atau alamat IP.

Jembatan keledai untuk urutannya, dari layer 1 ke atas: **P**lease **D**o **N**ot **T**hrow **S**ausage **P**izza **A**way.

## Tujuh lapisan sekilas

| # | Lapisan      | Satuan data   | Alamat        | Contoh                            | Perangkat              | Yang menjalankan di Linux       |
| - | ------------ | ------------- | ------------- | --------------------------------- | ---------------------- | ------------------------------- |
| 7 | Application  | pesan         | URL, hostname | HTTP, DNS, SSH, SMTP              | proxy L7, WAF          | programmu (nginx, curl, sshd)    |
| 6 | Presentation | pesan         | tidak ada     | enkripsi TLS, UTF-8, JSON, gzip   | tidak ada              | library di programmu (OpenSSL, zlib) |
| 5 | Session      | pesan         | ID sesi       | sesi TLS, stream HTTP/2, RPC      | tidak ada              | library di programmu             |
| 4 | Transport    | segment (TCP), datagram (UDP) | port | TCP, UDP                   | load balancer L4, firewall stateful | kernel (TCP, UDP, socket) |
| 3 | Network      | paket         | alamat IP     | IPv4, IPv6, ICMP                  | router                 | kernel (routing, netfilter)      |
| 2 | Data link    | frame         | alamat MAC    | Ethernet, Wi-Fi, VLAN, ARP        | switch, access point   | kernel dan driver (bridge, ARP)  |
| 1 | Physical     | bit           | tidak ada     | tembaga, fiber, radio             | kabel, hub, repeater   | hardware kartu jaringan          |

## OSI dan TCP/IP berdampingan

```
 Model OSI            Model TCP/IP        yang benar-benar berjalan
 ───────────────      ──────────────      ──────────────────────────────
 7 Application   ┐
 6 Presentation  ├──► Application         HTTP, DNS, SSH, TLS, JSON
 5 Session       ┘
 4 Transport     ───► Transport           TCP, UDP
 3 Network       ───► Internet            IP, ICMP
 2 Data link     ┐
 1 Physical      ┴──► Link                Ethernet, Wi-Fi, ARP
```

TCP/IP menggabungkan layer 5, 6, dan 7 menjadi satu lapisan aplikasi, karena dalam praktiknya satu program mengerjakan ketiganya. TCP/IP juga menggabungkan layer 1 dan 2, karena satu kartu jaringan mengerjakan keduanya.

Beberapa protokol tidak pas di satu lapisan. TLS mengenkripsi data (layer 6), menyimpan state sesi (layer 5), dan berjalan di dalam proses aplikasi (layer 7). ARP menerjemahkan alamat IP (layer 3) menjadi alamat MAC (layer 2). Pakai model ini untuk menemukan lokasi masalah, bukan untuk berdebat di lapisan mana sebuah protokol "seharusnya" berada.

## Enkapsulasi: cara lapisan bertumpuk

Saat program mengirim data, tiap lapisan dalam perjalanan turun menambahkan header miliknya di depan. Mesin penerima melepasnya dalam perjalanan naik, dengan urutan terbalik.

```
 L7  Application                            [ GET / HTTP/1.1 ]
 L6  Presentation                   [ TLS │ HTTP terenkripsi ]
 L5  Session                        (byte yang sama, di dalam sesi TLS yang terbuka)
 L4  Transport                [ TCP │ TLS │ HTTP terenkripsi ]
 L3  Network             [ IP │ TCP │ TLS │ HTTP terenkripsi ]
 L2  Data link    [ ETH │ IP │ TCP │ TLS │ HTTP terenkripsi │ FCS ]
 L1  Physical     10110001011101001010101110101001010...
```

Tiap lapisan hanya membaca header miliknya dan menganggap sisanya sebagai muatan. Switch membaca header Ethernet dan tidak lebih. Router membaca header IP. Hanya program penerima yang membaca request HTTP-nya. Karena itu kamu bisa pindah dari Wi-Fi ke Ethernet (layer 1 dan 2) tanpa mengganti browser (layer 7).

## Simulasi

Pilih skenario lalu jalankan langkah demi langkah. Dua tumpukan itu adalah mesin pengirim dan penerima, kolom tengah adalah perangkat di antaranya, dan bar di bawah menunjukkan bentuk paket pada saat itu. Setiap blok berwarna adalah header satu lapisan.

<div class="osi-sim" data-sim-lang="id"></div>

Yang perlu diperhatikan:

- Di skenario HTTPS, switch hanya membaca header Ethernet, dan router hanya membaca sampai header IP. Keduanya tidak bisa melihat request HTTP, karena TLS sudah mengenkripsinya di layer 6.
- Router membuat header Ethernet baru untuk link berikutnya. Alamat MAC berganti di setiap hop, sedangkan alamat IP tetap sama (kecuali di tempat NAT menulis ulang).
- Di skenario ping, tidak ada yang berjalan di atas layer 3. Kernel router menjawab sendiri. Ping yang berhasil hanya membuktikan layer 1 sampai 3.
- Di skenario DNS, UDP mengirim pertanyaan di paket pertama tanpa handshake. Kalau paket itu hilang, kernel tidak mengirim ulang. Program resolver yang mencoba lagi.

## Letak tiap lapisan di Linux

```
            ┌───────────────────────────────────────────┐
 L7         │ programmu: nginx, curl, sshd, browser     │
 L6         │ library: OpenSSL, zlib, parser JSON       │   user space
 L5         │ sesi TLS, stream HTTP/2                   │
            ├──────── socket API (system call) ─────────┤ ◄── socket(), connect(), read(), write()
 L4         │ TCP, UDP                                  │
 L3         │ IP, tabel routing, netfilter (nftables)   │   kernel
 L2         │ ARP, bridge, VLAN, qdisc, driver          │
            ├───────────────────────────────────────────┤
 L1 (+L2)   │ kartu jaringan: PHY, MAC, checksum, DMA   │   hardware
            └───────────────────────────────────────────┘
```

Socket API adalah garis pemisah antarlapisan. Semua yang ada di layer 4 ke bawah berjalan di kernel dan kartu jaringan. Semua yang ada di layer 5 ke atas berjalan di dalam programmu. Programmu tidak pernah membuat header IP atau TCP. Programmu memanggil `write()` pada socket, lalu kernel yang mengerjakan layer 4 sampai 2.

Pembagian ini menjelaskan beberapa hal sehari-hari di Linux:

- Mengubah rute, aturan firewall, atau interface butuh root, karena semua itu ada di kernel. Menjalankan web server di port 8080 tidak butuh root.
- Port di bawah 1024 butuh root atau `CAP_NET_BIND_SERVICE`. Kernel menerapkan aturan ini di layer 4 (`net.ipv4.ip_unprivileged_port_start = 1024`).
- `ping` jalan tanpa root di distribusi modern, karena kernel menyediakan socket ICMP tanpa hak khusus (`net.ipv4.ping_group_range`).
- Container Docker memakai kernel host, jadi kode layer 2 sampai 4-nya sama. Container mendapat interface, rute, dan socket sendiri lewat network namespace.

Beberapa alat memindahkan pekerjaan melewati garis itu:

| Alat       | Yang dipindahkan                                                      |
| ---------- | --------------------------------------------------------------------- |
| kTLS       | Enkripsi TLS (layer 6) ke dalam kernel, supaya nginx bisa `sendfile()` lewat HTTPS. Muat dengan `modprobe tls`. |
| QUIC       | Pengiriman andal (pekerjaan layer 4) ke dalam program, di atas UDP. HTTP/3 memakainya. |
| TUN / TAP  | Interface virtual yang menyerahkan paket layer 3 (TUN) atau frame layer 2 (TAP) ke sebuah program. VPN seperti OpenVPN dan Tailscale memakai TUN. |
| XDP / eBPF | Program kecil yang berjalan di driver sebelum kode layer 2 dan 3 milik kernel, dipakai untuk menyaring paket dengan cepat. |
| DPDK       | Program mengambil alih kartu jaringan dan menjalankan layer 2 sampai 4 sendiri, untuk laju paket yang sangat tinggi. |

Sistem operasi lain membagi pekerjaan dengan cara yang sama, hanya namanya berbeda:

| Lapisan      | Linux                       | Windows                       | macOS                              |
| ------------ | --------------------------- | ----------------------------- | ---------------------------------- |
| L1, L2       | driver (`r8169`, `iwlwifi`) | driver NDIS miniport          | driver DriverKit / IOKit           |
| L3, L4       | net stack kernel            | `tcpip.sys`                   | kernel XNU, stack turunan BSD      |
| batas        | BSD sockets                 | Winsock                       | BSD sockets, Network.framework     |
| L6 (TLS)     | OpenSSL, GnuTLS, kTLS       | Schannel                      | Network.framework                  |
| L7           | programmu                   | programmu                     | programmu                          |

Protokol di kabel sama di mana-mana, jadi laptop Windows dan server Linux bisa bicara tanpa perlakuan khusus.

## Lapisan demi lapisan

### Layer 1: Physical

Layer 1 memindahkan bit mentah sebagai tegangan di kabel tembaga, cahaya di fiber, atau gelombang radio. Layer ini tidak tahu apa pun soal alamat. Ia menentukan kecepatan link (100 Mbit/s, 1 Gbit/s, 10 Gbit/s), duplex, konektor, dan jenis kabel.

Kartu jaringan yang mengerjakannya. Linux hanya membaca hasilnya lewat driver.

```bash
ip -br link                               # UP, DOWN, atau NO-CARRIER untuk tiap interface
cat /sys/class/net/enp4s0/carrier         # 1 = kabel tercolok dan link menyala
cat /sys/class/net/enp4s0/speed           # 1000 = 1 Gbit/s
sudo ethtool enp4s0                       # kecepatan, duplex, "Link detected: yes"
ip -s link show enp4s0                    # counter paket, error, dan drop
dmesg -T | grep -i 'link is'              # "Link is Up - 1Gbps/Full"
iw dev wlan0 link                         # kekuatan sinyal dan bitrate Wi-Fi
```

```
$ ip -s link show enp4s0
3: enp4s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:2b:67:61:2c:81 brd ff:ff:ff:ff:ff:ff
    RX:  bytes packets errors dropped  missed   mcast
     342006120  446999      0     386       0    6821
    TX:  bytes packets errors dropped carrier collsns
     191352187  347042      0       0       0       0
```

`LOWER_UP` artinya kartu melihat ada link. `UP` saja hanya berarti seseorang sudah menjalankan `ip link set up`.

Kamu berurusan dengan layer 1 kalau:

- `ip link` menampilkan `NO-CARRIER`. Kabel tercabut, rusak, atau port switch-nya mati.
- Link berjalan di 100 Mbit/s, bukan 1 Gbit/s. Sering kali satu pasang kabel di dalamnya rusak.
- `errors` di `ip -s link` terus naik. Kabel jelek, port jelek, atau interferensi.
- Wi-Fi lambat dan `iw` menunjukkan sinyal lemah (lebih buruk dari sekitar -70 dBm).

### Layer 2: Data link

Layer 2 memindahkan frame antarmesin di jaringan lokal yang sama, artinya switch yang sama atau Wi-Fi yang sama. Alamatnya adalah alamat MAC 48 bit yang tertanam di tiap kartu jaringan.

Frame Ethernet berisi MAC tujuan, MAC sumber, field tipe (`0x0800` untuk IPv4, `0x86DD` untuk IPv6, `0x0806` untuk ARP), muatan, dan checksum 4 byte (FCS) di akhir. Muatan terbesar adalah MTU, biasanya 1500 byte.

Switch mempelajari alamat MAC mana yang ada di balik port mana, lalu mengirim tiap frame hanya ke port itu. ARP mencari alamat MAC untuk sebuah alamat IP di jaringan lokal. Satu mesin menyiarkan "siapa yang punya 192.168.1.1?" dan pemiliknya membalas dengan MAC-nya. VLAN (802.1Q) menambahkan tag ke frame supaya satu switch fisik bisa bertindak seperti beberapa switch terpisah.

Di Linux, driver dan kernel yang mengerjakan layer 2. Kernel menyimpan tabel ARP, dan bisa bertindak sebagai switch. `docker0` dan setiap interface `br-*` adalah switch software (bridge), dan tiap container dicolokkan ke salah satunya dengan pasangan `veth`.

```bash
ip link show enp4s0                     # link/ether = MAC-mu, mtu = muatan terbesar
ip neigh                                # tabel ARP: IP ke MAC untuk mesin di LAN-mu
sudo arping -I enp4s0 192.168.1.1       # kirim request ARP langsung
sudo tcpdump -eni enp4s0 arp            # -e mencetak alamat MAC
bridge link                             # interface mana tercolok ke bridge mana
ip -d link show docker0                 # -d menunjukkan bahwa ini bridge
sudo ip link add link enp4s0 name enp4s0.10 type vlan id 10   # VLAN 10 di atas enp4s0
```

```
$ ip neigh
192.168.1.1 dev enp4s0 lladdr d8:9a:0d:80:8f:f9 REACHABLE
172.19.0.2 dev br-68d019f1085b lladdr 06:79:9a:ff:17:c3 REACHABLE
172.22.0.2 dev br-3325c98c3499 lladdr f6:49:01:ca:f3:93 STALE
```

Baris pertama adalah router rumah. Dua lainnya adalah container Docker di balik bridge software.

Kamu berurusan dengan layer 2 kalau:

- `ip neigh` menampilkan `FAILED` atau `INCOMPLETE` untuk gateway-mu. Tidak ada yang bisa dijangkau di luar LAN.
- Dua mesin punya IP yang sama. Jawaban ARP berganti-ganti antara dua MAC, dan koneksi putus secara acak.
- Paket kecil lancar tetapi paket besar menggantung. SSH bisa login, lalu macet saat `ls` di direktori besar. Ada MTU yang lebih kecil di jalur, sering kali VPN atau tunnel.
- Kamu mencolokkan satu kabel ke dua port di switch yang sama dan jaringan mati. Loop itu membuat broadcast berputar terus, kecuali switch-nya menjalankan Spanning Tree.

### Layer 3: Network

Layer 3 memindahkan paket antarjaringan, melintasi seluruh internet, satu router demi satu router. Alamatnya adalah alamat IP ditambah subnet mask, yang menentukan alamat mana yang lokal.

Setiap router membaca IP tujuan, mencarinya di tabel routing, lalu mengirim paket ke router berikutnya. Tiap router mengurangi TTL (time to live) satu. Saat TTL mencapai 0, router membuang paket dan mengirim balik pesan ICMP "time exceeded". `traceroute` memanfaatkan ini untuk menemukan setiap router di jalur. ICMP juga membawa `ping` dan pesan error seperti "destination unreachable". Router rumahmu juga menjalankan NAT. Router menulis ulang alamat sumber privatmu (`192.168.x.x`) menjadi satu alamat publik miliknya.

Di Linux, kernel yang mengerjakan layer 3. Kernel memegang tabel routing, memutuskan apakah sebuah paket untuk mesin ini atau perlu diteruskan, dan menjalankan hook netfilter tempat aturan nftables diterapkan.

```bash
ip -br addr                             # alamat IP di tiap interface
ip route                                # tabel routing
ip route get 1.1.1.1                    # rute, interface, dan IP sumber yang akan dipakai kernel
ping -c 3 192.168.1.1                   # ICMP echo: apakah layer 3 sampai ke host itu?
tracepath -n 1.1.1.1                    # setiap router di jalur, plus path MTU
mtr -n 1.1.1.1                          # traceroute langsung dengan kehilangan paket per hop
sysctl net.ipv4.ip_forward              # 1 = mesin ini meneruskan paket untuk mesin lain
sudo nft list ruleset                   # aturan firewall di hook layer 3
```

```
$ ip route get 1.1.1.1
1.1.1.1 via 192.168.1.1 dev enp4s0 src 192.168.1.6 uid 1000

$ tracepath -n 1.1.1.1
 1?: [LOCALHOST]                      pmtu 1500
 1:  192.168.1.1                                           0.655ms
 2:  10.89.192.1                                           6.320ms
 3:  no reply
 4:  162.158.43.14                                         3.588ms
```

Kamu berurusan dengan layer 3 kalau:

- Muncul `Network is unreachable`. Kernel tidak punya rute untuk alamat itu. Cek apakah `ip route` punya baris `default via`.
- Muncul `No route to host`. Rutenya ada, tetapi host tidak menjawab ARP, atau router atau firewall mengirim balik ICMP "unreachable".
- LAN jalan tetapi internet tidak. Default gateway salah atau mati.
- Mesin Linux yang seharusnya meneruskan paket (server VPN, host Docker, router) tidak melakukannya. `ip_forward` bernilai 0, atau chain `forward` di firewall membuang lalu lintasnya.
- `ping` berhasil tetapi layanannya tidak. Layer 3 baik-baik saja. Naik ke layer 4.

### Layer 4: Transport

Layer 4 memindahkan data antarprogram. IP mengantar paket ke mesin yang benar. Nomor port mengantarnya ke program yang benar di mesin itu. Satu koneksi dikenali dari empat nilai: IP sumber, port sumber, IP tujuan, dan port tujuan.

Ada dua protokol utama.

TCP memberi aliran byte yang andal dan berurutan. TCP membuka koneksi dengan three-way handshake, memberi nomor setiap byte, menunggu acknowledgment, mengirim ulang yang hilang, dan melambat saat jaringan atau penerima penuh.

```
 klien                                  server (listen di port 443)
   │ ── SYN ─────────────────────────────► │
   │ ◄──────────────────────────── SYN+ACK │
   │ ── ACK ─────────────────────────────► │   koneksi terbuka, data bisa mengalir
```

UDP mengirim datagram yang berdiri sendiri. Tidak ada handshake, tidak ada urutan, dan tidak ada pengiriman ulang. Header-nya 8 byte. Datagram yang hilang ya hilang, kecuali programnya mengirim ulang.

| Pakai TCP kalau                                 | Pakai UDP kalau                                  |
| ----------------------------------------------- | ------------------------------------------------ |
| Setiap byte penting: halaman web, file, API, SSH | Data telat tidak berguna: panggilan suara dan video, game |
| Urutan penting: query database                  | Pesan kecil dan berdiri sendiri: DNS, NTP, DHCP  |
| Kamu ingin kernel yang mengurus pengiriman ulang | Kamu mengurus keandalan sendiri, seperti QUIC   |

HTTP/3 berjalan di atas QUIC, yang berjalan di atas UDP. QUIC mengerjakan tugas layer 4 di dalam browser, jadi satu paket hilang hanya menahan satu stream, bukan seluruh koneksi.

Di Linux, kernel yang menjalankan TCP dan UDP. Programmu hanya melihat socket, yang berupa file descriptor.

```bash
ss -tulpn                               # port TCP dan UDP yang listen beserta prosesnya
ss -tan state established               # koneksi TCP yang terbuka
ss -ti                                  # detail per koneksi: rtt, congestion window, retransmisi
nc -zv example.com 443                  # bisakah koneksi TCP ke port ini dibuka?
sudo tcpdump -ni any 'tcp[tcpflags] & tcp-syn != 0'   # hanya percobaan koneksi
nstat -az | grep -i retrans             # counter retransmisi kernel
```

```
$ ss -tlnp
State  Recv-Q Send-Q   Local Address:Port  Peer Address:Port
LISTEN 0      4096     127.0.0.53%lo:53         0.0.0.0:*
LISTEN 0      4096           0.0.0.0:4000       0.0.0.0:*
```

`127.0.0.53:53` adalah systemd-resolved, cache DNS lokal. Ia hanya listen di loopback, jadi mesin lain tidak bisa menjangkaunya. `0.0.0.0:4000` menerima koneksi di semua interface.

Kamu berurusan dengan layer 4 kalau:

- Muncul `Connection refused`. Host-nya menyala, tetapi tidak ada yang listen di port itu dan kernel menjawab RST. Cek `ss -tlnp`.
- Koneksi menggantung lalu timeout. Ada yang membuang paket, biasanya firewall. Penolakan gagal dalam milidetik, timeout butuh detik atau menit.
- Layanan jalan dari server itu sendiri tetapi tidak dari luar. Ia listen di `127.0.0.1`, bukan `0.0.0.0`.
- Muncul `Address already in use`. Proses lain memegang port itu.
- Jumlah `CLOSE-WAIT` di `ss -tan` terus naik. Programmu tidak memanggil `close()` pada socket yang sudah ditutup lawan.

### Layer 5: Session

Layer 5 membuka, menjaga, melanjutkan, dan menutup percakapan antara dua program. TCP/IP tidak punya lapisan sesi tersendiri. Program dan library mengerjakannya sendiri, jadi lapisan ini paling sulit ditunjuk.

Contoh nyatanya:

- TLS session resumption. Klien yang tersambung ulang bisa memakai kunci dari sesi sebelumnya dan melewati sebagian besar handshake.
- HTTP/2 dan HTTP/3 menjalankan banyak stream request di dalam satu koneksi.
- HTTP keep-alive dan connection pool memakai satu koneksi TCP untuk banyak request.
- SSH multiplexing (`ControlMaster`) menjalankan banyak perintah `ssh` dan `scp` lewat satu sesi SSH yang terbuka.
- Framework RPC, proxy SOCKS, dan berbagi file SMB menyimpan sesi masing-masing.

Cookie login juga disebut "session", tetapi itu milik aplikasi di layer 7.

Di Linux, layer 5 berjalan di user space, di dalam programmu atau library-nya.

```bash
openssl s_client -connect example.com:443 -tls1_2 -reconnect </dev/null 2>/dev/null | grep -E '^(New|Reused)'
# New, TLSv1.2, Cipher is ECDHE-ECDSA-CHACHA20-POLY1305       ← koneksi pertama: handshake penuh
# Reused, TLSv1.2, Cipher is ECDHE-ECDSA-CHACHA20-POLY1305    ← sambungan ulang melanjutkan sesi

curl -sv -o /dev/null -o /dev/null https://example.com/ https://example.com/ 2>&1 | grep -i 're-using'
# * Re-using existing connection with host example.com        ← request kedua, tanpa handshake baru

ssh -O check prod                       # apakah ada sesi SSH bersama yang terbuka?
```

Kamu berurusan dengan layer 5 kalau:

- Setiap request membayar handshake TCP dan TLS baru karena klien tidak memakai ulang koneksi.
- Load balancer mengirim tiap request dari satu sesi ke backend yang berbeda. Ini butuh "sticky session" atau penyimpanan sesi bersama.
- Koneksi berumur panjang (WebSocket, pool database) mati setelah idle timeout di proxy atau NAT.

### Layer 6: Presentation

Layer 6 memastikan kedua sisi membaca byte dengan cara yang sama. Lapisan ini mencakup encoding (UTF-8), serialisasi (JSON, Protocol Buffers), kompresi (gzip, Brotli), dan enkripsi (TLS).

Di Linux, layer 6 juga berjalan di user space, di library seperti OpenSSL, zlib, dan parser JSON di dalam programmu. Pengecualiannya kTLS, di mana kernel mengenkripsi record TLS setelah program menyelesaikan handshake.

```bash
openssl s_client -connect example.com:443 -servername example.com -brief </dev/null
printf 'é' | od -An -tx1                 # c3 a9: huruf é sebagai byte UTF-8
printf '\xc3\xa9' | iconv -f latin1 -t utf-8   # Ã©: byte yang sama dibaca sebagai Latin-1
file data.bin                            # tebak format file dari byte-nya
curl -s --compressed -o /dev/null -w '%{size_download}\n' https://example.com
```

```
$ openssl s_client -connect example.com:443 -servername example.com -brief </dev/null
CONNECTION ESTABLISHED
Protocol version: TLSv1.3
Ciphersuite: TLS_AES_256_GCM_SHA384
Peer certificate: CN = example.com
Verification: OK
```

Kamu berurusan dengan layer 6 kalau:

- Teks tampil sebagai `Ã©`, bukan `é`. Satu sisi menulis UTF-8 dan sisi lain membacanya sebagai Latin-1.
- TLS gagal dengan `certificate has expired` atau nama host tidak cocok.
- OpenSSL menampilkan `wrong version number`. Klien bicara TLS ke port yang bicara HTTP biasa.
- API membalas `415 Unsupported Media Type`. Kamu mengirim form data padahal API-nya menunggu JSON.

### Layer 7: Application

Layer 7 adalah protokol yang dipakai programmu: HTTP, DNS, SSH, SMTP, IMAP, MQTT, protokol wire PostgreSQL. Alamat di sini berupa hostname, URL, path, dan alamat email.

Di Linux, layer 7 adalah program dan daemon biasa: nginx, sshd, postfix, dan systemd-resolved untuk DNS.

```bash
curl -v https://example.com             # DNS, koneksi TCP, TLS, lalu request dan respons HTTP
dig example.com                         # pertanyaan dan jawaban DNS
resolvectl status                       # server DNS yang dipakai systemd-resolved
ssh -v user@host                        # negosiasi SSH langkah demi langkah
journalctl -u nginx -n 50               # log layanan layer 7
```

`curl -v` melewati beberapa lapisan dalam satu perintah:

```
* Host example.com:443 was resolved.                       ← L7: DNS menjawab
* Connected to example.com (172.66.147.243) port 443       ← L3 dan L4: rute ditemukan, handshake TCP selesai
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384    ← L5 dan L6: sesi TLS dan enkripsi
* ALPN: server accepted h2                                 ← kedua sisi sepakat memakai HTTP/2
> GET / HTTP/2                                             ← L7: request
< HTTP/2 200                                               ← L7: respons
```

Kamu berurusan dengan layer 7 kalau:

- `Could not resolve host`. DNS gagal. Cek `resolvectl status` dan `dig`.
- HTTP membalas 4xx atau 5xx. `502 Bad Gateway` berarti proxy sudah sampai ke layer 4 backend-nya tetapi tidak mendapat balasan HTTP yang valid.
- Situs yang salah yang menjawab. Header `Host` atau nama SNI di TLS tidak cocok dengan konfigurasi server.

## Perangkat dan lapisan tempatnya bekerja

| Lapisan | Perangkat dan software                                               | Padanan di Linux                      |
| ------- | -------------------------------------------------------------------- | ------------------------------------- |
| 1       | kabel, hub, repeater, media converter                                | tidak ada                             |
| 2       | switch, access point, bridge                                         | `ip link add br0 type bridge`         |
| 3       | router, switch layer 3                                               | `sysctl net.ipv4.ip_forward=1`        |
| 3, 4    | firewall stateful, security group cloud, NAT                         | nftables                              |
| 4       | load balancer L4 (AWS NLB, IPVS)                                     | `ipvsadm`, HAProxy `mode tcp`         |
| 7       | reverse proxy, load balancer L7 (AWS ALB), WAF, API gateway          | nginx, HAProxy `mode http`, Envoy     |

Satu mesin Linux bisa mengerjakan semuanya sekaligus. Host Docker biasa adalah switch (bridge), router (`ip_forward`), firewall dan NAT (nftables), dan sering juga reverse proxy (nginx).

### Load balancing L4 atau L7

Ini salah satu keputusan nyata yang paling sering memakai nomor OSI.

| Load balancer L4                                     | Load balancer L7                                      |
| ---------------------------------------------------- | ----------------------------------------------------- |
| Hanya melihat alamat IP dan port                     | Membaca request HTTP lengkap                          |
| Bisa untuk protokol TCP atau UDP apa pun: database, MQTT, server game | Untuk HTTP, gRPC, WebSocket          |
| Meneruskan TLS apa adanya, backend yang memegang sertifikat | Mengakhiri TLS, load balancer yang memegang sertifikat |
| Tidak bisa merutekan berdasarkan URL, header, atau cookie | Merutekan berdasarkan host, path, header, atau cookie |
| CPU per koneksi sangat kecil                         | CPU lebih besar, tetapi bisa retry, cache, kompresi, dan menambah header |

Pilih L4 untuk lalu lintas non-HTTP, atau kalau backend harus melihat koneksi TLS aslinya. Pilih L7 kalau kamu butuh routing berdasarkan path (`/api` ke satu layanan, `/` ke layanan lain), satu sertifikat untuk banyak backend, atau retry dan log di level HTTP.

## Troubleshooting dari bawah ke atas

Saat sesuatu tidak tersambung, cek lapisannya berurutan dari 1 sampai 7. Berhenti di lapisan pertama yang gagal. Masalah di lapisan bawah merusak semua yang ada di atasnya.

```bash
ip -br link                                        # L1: apakah interface UP dengan LOWER_UP?
ip neigh show 192.168.1.1                          # L2: apakah gateway menjawab ARP (REACHABLE)?
ip route get 1.1.1.1 && ping -c 2 1.1.1.1          # L3: ada rute, dan paketnya kembali?
nc -zv example.com 443                             # L4: bisakah koneksi TCP dibuka?
openssl s_client -connect example.com:443 -brief </dev/null   # L5, L6: apakah TLS jalan?
curl -v https://example.com                        # L7: apakah aplikasinya menjawab?
```

`curl -v` saja sering sudah menunjukkan lapisan mana yang berhenti, karena ia mencetak tiap tahap sebelum gagal.

Pesan error yang umum dan lapisannya:

| Pesan                                     | Lapisan | Arti                                               |
| ----------------------------------------- | ------- | -------------------------------------------------- |
| `NO-CARRIER` di `ip link`                 | 1       | Tidak ada link fisik.                              |
| `FAILED` di `ip neigh`                    | 2       | Host tidak menjawab ARP.                           |
| `Network is unreachable`                  | 3       | Tidak ada rute untuk alamat itu.                   |
| `No route to host`                        | 3       | Host tidak menjawab ARP, atau firewall menolak dengan ICMP. |
| `Connection timed out`                    | 3 atau 4 | Paket dibuang di suatu tempat di jalur.           |
| `Connection refused`                      | 4       | Tidak ada yang listen di port itu.                 |
| `wrong version number`                    | 6       | Klien TLS bicara ke port non-TLS.                  |
| `certificate has expired`                 | 6       | Masalah sertifikat.                                |
| `Could not resolve host`                  | 7       | Pencarian DNS gagal.                               |
| `502 Bad Gateway`                         | 7       | Proxy tidak mendapat jawaban valid dari backend-nya. |

## Melihat layer 2 sampai 4 dalam satu tangkapan

`tcpdump -e` juga mencetak header Ethernet, jadi satu baris menunjukkan tiga lapisan sekaligus:

```bash
sudo tcpdump -eni enp4s0 -c 3 'tcp port 443'      # terminal 1
curl -s -o /dev/null https://example.com          # terminal 2
```

```
00:2b:67:61:2c:81 > d8:9a:0d:80:8f:f9, ethertype IPv4 (0x0800), length 74: 192.168.1.6.51234 > 172.66.147.243.443: Flags [S], seq 3542141823, win 64240, length 0
└───────── L2: alamat MAC ──────────┘  └───── L2: tipe ──────┘             └───────── L3: IP, L4: port ─────────┘  └ L4: flag ┘
```

Baris ini dipersingkat, dan port serta angkamu akan berbeda. MAC tujuannya milik router (`d8:9a:0d:80:8f:f9` dari `ip neigh`), sedangkan IP tujuannya milik web server. Mesinmu mengirim frame ke router di layer 2 dan mengalamatkan paket ke server di layer 3. Layer 7 terenkripsi, jadi `tcpdump` tidak bisa menampilkan request HTTP-nya.

## Ringkasan

1. OSI punya tujuh lapisan. TCP/IP, yang dijalankan internet, punya empat. Orang tetap memakai nomor OSI.
2. Tiap lapisan menambahkan header saat turun dan melepasnya saat naik. Tiap perangkat hanya membaca lapisan yang ia butuhkan.
3. Di Linux, kartu jaringan mengerjakan layer 1. Kernel mengerjakan layer 2 sampai 4. Programmu mengerjakan layer 5 sampai 7. Socket API adalah garis antara kernel dan programmu.
4. Alamat MAC berganti di setiap hop. Alamat IP tetap sama dari ujung ke ujung, kecuali di tempat NAT menulis ulang.
5. Troubleshoot dari layer 1 ke atas. `ping` hanya membuktikan layer 3, `nc -z` membuktikan layer 4, dan `curl -v` menunjukkan semuanya.

</div>

<style>
.osi-sim{border:1px solid #d0d7de;border-radius:.75rem;padding:1rem;margin:1.5em 0;background:#fff;font-size:.9rem}
.osi-sim__bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:1rem}
.osi-sim__bar select,.osi-sim__bar button{border:1px solid #d0d7de;border-radius:.5rem;padding:.3rem .75rem;background:#f6f8fa;font-size:.85rem;line-height:1.25rem;cursor:pointer;color:#1f2328}
.osi-sim__bar button:hover:not(:disabled){background:#e9ecef;border-color:#afb8c1}
.osi-sim__bar button:disabled{opacity:.45;cursor:not-allowed}
.osi-sim__count{margin-left:auto;color:#636c76;font-size:.8rem}
.osi-sim__stage{display:grid;grid-template-columns:1fr minmax(6rem,.8fr) 1fr;gap:.75rem;align-items:start}
.osi-sim__title{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#636c76;text-align:center;margin-bottom:.35rem;min-height:2.2em}
.osi-sim__stack{display:flex;flex-direction:column;gap:3px}
.osi-sim__layer{display:flex;gap:.4rem;align-items:center;border:1px solid #d0d7de;border-radius:.35rem;padding:.2rem .45rem;font-size:.78rem;color:#636c76;background:#fff;transition:background .25s,color .25s,border-color .25s}
.osi-sim__layer b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;min-width:1.5rem}
.osi-sim__layer.is-active{color:#1f2328;font-weight:600;box-shadow:0 0 0 2px var(--c)}
.osi-sim__layer.is-active,.osi-sim__layer.is-done{background:var(--bg);border-color:var(--c)}
.osi-sim__net{display:flex;flex-direction:column;gap:.5rem;padding-top:2.55rem}
.osi-sim__dev{border:1px dashed #afb8c1;border-radius:.5rem;padding:.4rem;text-align:center;font-size:.78rem;color:#636c76;transition:background .25s}
.osi-sim__dev small{display:block;font-size:.68rem}
.osi-sim__dev.is-active{border-style:solid;border-color:#1f2328;background:#fff8c5;color:#1f2328;font-weight:600}
.osi-sim__wire{height:2px;background:repeating-linear-gradient(90deg,#afb8c1 0 6px,transparent 6px 10px);margin:.25rem 0}
.osi-sim__where{margin-top:1rem;font-size:.78rem;color:#636c76}
.osi-sim__packet{display:flex;flex-wrap:wrap;gap:3px;margin-top:.35rem;min-height:2rem}
.osi-sim__chip{border:1px solid var(--c);background:var(--bg);color:#1f2328;border-radius:.3rem;padding:.2rem .45rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;line-height:1.3}
.osi-sim__chip i{font-style:normal;font-weight:700;color:var(--c);margin-right:.3rem}
.osi-sim__chip.is-read{box-shadow:0 0 0 2px var(--c);font-weight:600}
.osi-sim__note{margin-top:.75rem;padding:.6rem .8rem;background:#f6f8fa;border-left:3px solid #0969da;border-radius:.25rem;min-height:3.5rem}
.osi-sim__linux{margin-top:.5rem;font-size:.82rem;color:#1f2328}
.osi-sim__linux b{color:#1a7f37}
.osi-sim [data-l="7"]{--c:#8250df;--bg:#fbefff}
.osi-sim [data-l="6"]{--c:#bf3989;--bg:#ffeff7}
.osi-sim [data-l="5"]{--c:#cf222e;--bg:#ffebe9}
.osi-sim [data-l="4"]{--c:#bc4c00;--bg:#fff1e5}
.osi-sim [data-l="3"]{--c:#9a6700;--bg:#fff8c5}
.osi-sim [data-l="2"]{--c:#1a7f37;--bg:#dafbe1}
.osi-sim [data-l="1"]{--c:#0969da;--bg:#ddf4ff}
@media (max-width:40rem){.osi-sim__stage{grid-template-columns:1fr 4.5rem 1fr;gap:.35rem}.osi-sim__title{min-height:5.4em;font-size:.65rem}.osi-sim__net{padding-top:4.6rem}.osi-sim__layer span{display:none}.osi-sim__layer{justify-content:center}.osi-sim__dev{font-size:.68rem;padding:.3rem .15rem}}
</style>

<script>
(() => {
  const LAYERS = ["", "Physical", "Data link", "Network", "Transport", "Session", "Presentation", "Application"];
  const T = {
    en: {
      scenario: "Scenario", back: "Back", next: "Next", play: "Play", pause: "Pause", reset: "Reset", step: "Step",
      linux: "In Linux:", down: "going down", up: "going up", transit: "in transit", start: "Press Next to start.",
      names: { https: "HTTPS request to a web server", ping: "ping the home router", dns: "DNS lookup over UDP" },
      devices: { switch: "Switch", router: "Router" },
    },
    id: {
      scenario: "Skenario", back: "Mundur", next: "Lanjut", play: "Putar", pause: "Jeda", reset: "Ulang", step: "Langkah",
      linux: "Di Linux:", down: "turun", up: "naik", transit: "di perjalanan", start: "Tekan Lanjut untuk mulai.",
      names: { https: "Request HTTPS ke web server", ping: "ping ke router rumah", dns: "Pencarian DNS lewat UDP" },
      devices: { switch: "Switch", router: "Router" },
    },
  };
  const c = (l, t) => ({ l, t });
  const ETH1 = c(2, "ETH aa:..:10 → aa:..:01");
  const FCS = c(2, "FCS");
  const BITS = [c(1, "1011 0001 0111 0100 1010 1011 1010 1001 ...")];
  const TLS = [c(6, "TLS record"), c(7, { en: "encrypted HTTP", id: "HTTP terenkripsi" })];
  const TCP = c(4, "TCP :51234 → :443");
  const IP1 = c(3, "IP 192.168.1.10 → 198.51.100.20 TTL 64");
  const IP2 = c(3, "IP 203.0.113.7 → 198.51.100.20 TTL 63");
  const ETH2 = c(2, "ETH bb:..:07 → cc:..:01");
  const SCENARIOS = {
    https: {
      left: { en: "Laptop 192.168.1.10", id: "Laptop 192.168.1.10" },
      right: { en: "Server 198.51.100.20 (nginx)", id: "Server 198.51.100.20 (nginx)" },
      devices: ["switch", "router"],
      intro: {
        en: "The browser already knows example.com is 198.51.100.20 (see the DNS scenario) and has an open TLS connection. Now it sends GET /.",
        id: "Browser sudah tahu example.com adalah 198.51.100.20 (lihat skenario DNS) dan sudah punya koneksi TLS yang terbuka. Sekarang ia mengirim GET /.",
      },
      steps: [
        { at: "L", l: 7, pkt: [c(7, "GET / HTTP/1.1  Host: example.com")],
          en: "The browser writes the HTTP request. This is plain text that any HTTP server understands.",
          id: "Browser menulis request HTTP. Ini teks biasa yang dimengerti semua server HTTP.",
          lx: { en: "User space. The browser or curl process.", id: "User space. Proses browser atau curl." } },
        { at: "L", l: 6, pkt: [...TLS],
          en: "TLS encrypts the request with the keys agreed during the handshake. From here on, nobody between the two machines can read or change the HTTP.",
          id: "TLS mengenkripsi request dengan kunci yang disepakati saat handshake. Mulai di sini, tidak ada yang di antara kedua mesin bisa membaca atau mengubah HTTP-nya.",
          lx: { en: "User space. OpenSSL (BoringSSL in Chrome) inside the same process. With kTLS, the kernel can do the encryption instead.", id: "User space. OpenSSL (BoringSSL di Chrome) di dalam proses yang sama. Dengan kTLS, kernel bisa mengerjakan enkripsinya." } },
        { at: "L", l: 5, pkt: [...TLS],
          en: "Layer 5 adds no header here. The TLS session already exists, so this request reuses it with no new handshake. Not every layer adds bytes.",
          id: "Layer 5 tidak menambah header di sini. Sesi TLS sudah ada, jadi request ini memakainya ulang tanpa handshake baru. Tidak semua lapisan menambah byte.",
          lx: { en: "User space. The TLS library keeps the session keys. HTTP/2 streams also live at this level.", id: "User space. Library TLS menyimpan kunci sesi. Stream HTTP/2 juga ada di level ini." } },
        { at: "L", l: 4, pkt: [TCP, ...TLS],
          en: "The program calls write() on the socket. The kernel adds a TCP header with the source port (51234, picked by the kernel) and the destination port (443), plus sequence numbers.",
          id: "Program memanggil write() pada socket. Kernel menambahkan header TCP berisi port sumber (51234, dipilih kernel) dan port tujuan (443), plus sequence number.",
          lx: { en: "Kernel. This is where user space ends. TCP keeps a copy until the server acknowledges it.", id: "Kernel. Di sinilah user space berakhir. TCP menyimpan salinannya sampai server meng-ACK." } },
        { at: "L", l: 3, pkt: [IP1, TCP, ...TLS],
          en: "The kernel adds the IP header. The server is not on the local network, so the routing table says to send it via the gateway 192.168.1.1.",
          id: "Kernel menambahkan header IP. Server tidak ada di jaringan lokal, jadi tabel routing menyuruh mengirimnya lewat gateway 192.168.1.1.",
          lx: { en: "Kernel. ip route get 198.51.100.20 shows this decision. nftables output rules run here.", id: "Kernel. ip route get 198.51.100.20 menunjukkan keputusan ini. Aturan output nftables berjalan di sini." } },
        { at: "L", l: 2, pkt: [ETH1, IP1, TCP, ...TLS, FCS],
          en: "The kernel adds the Ethernet header. The destination MAC is the router's (aa:..:01), not the server's. The IP header still points at the server.",
          id: "Kernel menambahkan header Ethernet. MAC tujuannya milik router (aa:..:01), bukan milik server. Header IP tetap menunjuk ke server.",
          lx: { en: "Kernel and driver. The MAC comes from the ARP table (ip neigh). The frame waits in the qdisc, then goes to the driver.", id: "Kernel dan driver. MAC-nya diambil dari tabel ARP (ip neigh). Frame menunggu di qdisc, lalu masuk ke driver." } },
        { at: "L", l: 1, pkt: BITS,
          en: "The network card turns the frame into electrical signals on the cable (or radio waves on Wi-Fi).",
          id: "Kartu jaringan mengubah frame menjadi sinyal listrik di kabel (atau gelombang radio di Wi-Fi).",
          lx: { en: "Hardware. The card reads the frame from RAM with DMA. ip -s link counts the TX packet.", id: "Hardware. Kartu membaca frame dari RAM lewat DMA. ip -s link menghitung paket TX-nya." } },
        { at: "switch", l: 2, pkt: [ETH1, IP1, TCP, ...TLS, FCS], read: [0],
          en: "The switch reads only the destination MAC, finds which port the router is on, and sends the frame out of that port. It never looks at the IP header.",
          id: "Switch hanya membaca MAC tujuan, mencari port tempat router berada, lalu mengirim frame keluar dari port itu. Switch tidak pernah melihat header IP.",
          lx: { en: "A Linux bridge such as docker0 does the same job in software.", id: "Bridge Linux seperti docker0 mengerjakan hal yang sama secara software." } },
        { at: "router", l: 3, pkt: [ETH2, IP2, TCP, ...TLS, c(2, "FCS")], read: [0, 1],
          en: "The router removes the old Ethernet header, reads the destination IP, lowers TTL from 64 to 63, and uses NAT to replace the private source IP with its public one. It then builds a new Ethernet header for the next link.",
          id: "Router melepas header Ethernet lama, membaca IP tujuan, menurunkan TTL dari 64 ke 63, dan memakai NAT untuk mengganti IP sumber privat dengan IP publiknya. Lalu ia membuat header Ethernet baru untuk link berikutnya.",
          lx: { en: "Many home routers run Linux. ip_forward=1 does the routing and an nftables masquerade rule does the NAT.", id: "Banyak router rumah menjalankan Linux. ip_forward=1 mengerjakan routing dan aturan masquerade nftables mengerjakan NAT." } },
        { at: "R", l: 1, pkt: BITS,
          en: "Many routers later, the server's network card receives the signals and checks the FCS checksum.",
          id: "Setelah banyak router, kartu jaringan server menerima sinyalnya dan mengecek checksum FCS.",
          lx: { en: "Hardware. The card writes the frame to RAM and raises an interrupt. The driver collects it with NAPI polling.", id: "Hardware. Kartu menulis frame ke RAM lalu memicu interrupt. Driver mengambilnya dengan polling NAPI." } },
        { at: "R", l: 2, pkt: [c(2, "ETH ee:..:01 → ee:..:20"), IP2, TCP, ...TLS, c(2, "FCS")], read: [0],
          en: "The destination MAC is the server's own, so the kernel accepts the frame and removes the Ethernet header and FCS.",
          id: "MAC tujuannya milik server sendiri, jadi kernel menerima frame lalu melepas header Ethernet dan FCS-nya.",
          lx: { en: "Kernel and driver. A frame for another MAC is dropped here, unless the card is in promiscuous mode, which tcpdump turns on.", id: "Kernel dan driver. Frame untuk MAC lain dibuang di sini, kecuali kartu dalam mode promiscuous, yang dinyalakan tcpdump." } },
        { at: "R", l: 3, pkt: [IP2, TCP, ...TLS], read: [0],
          en: "The destination IP belongs to this server, so the kernel removes the IP header and passes the rest to TCP.",
          id: "IP tujuannya milik server ini, jadi kernel melepas header IP dan meneruskan sisanya ke TCP.",
          lx: { en: "Kernel. nftables prerouting and input rules run here. A drop rule would stop the packet at this point.", id: "Kernel. Aturan prerouting dan input nftables berjalan di sini. Aturan drop akan menghentikan paket di titik ini." } },
        { at: "R", l: 4, pkt: [TCP, ...TLS], read: [0],
          en: "Port 443 belongs to nginx's socket. TCP checks the sequence number, sends an ACK back, and puts the bytes in the socket's receive buffer.",
          id: "Port 443 milik socket nginx. TCP mengecek sequence number, mengirim ACK balik, dan menaruh byte-nya di buffer terima socket.",
          lx: { en: "Kernel. ss -tn 'sport = :443' shows this connection.", id: "Kernel. ss -tn 'sport = :443' menampilkan koneksi ini." } },
        { at: "R", l: 5, pkt: [...TLS],
          en: "nginx's read() returns the bytes. The TLS library finds the session for this connection.",
          id: "read() milik nginx mengembalikan byte-nya. Library TLS menemukan sesi untuk koneksi ini.",
          lx: { en: "User space. From here up, everything runs inside the nginx process.", id: "User space. Dari sini ke atas, semuanya berjalan di dalam proses nginx." } },
        { at: "R", l: 6, pkt: [c(7, "GET / HTTP/1.1  Host: example.com")],
          en: "OpenSSL decrypts the record and checks that nobody changed it on the way.",
          id: "OpenSSL mendekripsi record itu dan mengecek bahwa tidak ada yang mengubahnya di jalan.",
          lx: { en: "User space. OpenSSL inside nginx.", id: "User space. OpenSSL di dalam nginx." } },
        { at: "R", l: 7, pkt: [c(7, "GET / HTTP/1.1  Host: example.com")], read: [0],
          en: "nginx reads GET / and the Host header, picks the matching server block, and answers. The response travels down the same seven layers and back.",
          id: "nginx membaca GET / dan header Host, memilih server block yang cocok, lalu menjawab. Responsnya melewati tujuh lapisan yang sama, turun lalu naik lagi.",
          lx: { en: "User space. nginx, logged in /var/log/nginx/access.log.", id: "User space. nginx, tercatat di /var/log/nginx/access.log." } },
      ],
    },
    ping: {
      left: { en: "Laptop 192.168.1.10", id: "Laptop 192.168.1.10" },
      right: { en: "Home router 192.168.1.1", id: "Router rumah 192.168.1.1" },
      devices: ["switch"],
      top: 3,
      intro: {
        en: "Run ping 192.168.1.1. The laptop does not know the router's MAC address yet.",
        id: "Jalankan ping 192.168.1.1. Laptop belum tahu alamat MAC router.",
      },
      steps: [
        { at: "L", l: 3, pkt: [c(3, "IP 192.168.1.10 → 192.168.1.1"), c(3, "ICMP echo request seq=1")],
          en: "ping asks the kernel to send an ICMP echo request. ICMP goes directly inside the IP packet. There is no TCP, no UDP, and no port number.",
          id: "ping meminta kernel mengirim ICMP echo request. ICMP langsung berada di atas IP. Tidak ada TCP, tidak ada UDP, dan tidak ada nomor port.",
          lx: { en: "ping opens an unprivileged ICMP socket, so it needs no root. The kernel builds the IP header.", id: "ping membuka socket ICMP tanpa hak khusus, jadi tidak butuh root. Kernel yang membuat header IP." } },
        { at: "L", l: 2, pkt: [c(2, "ETH aa:..:10 → ff:ff:ff:ff:ff:ff"), c(2, "ARP who-has 192.168.1.1 tell 192.168.1.10")],
          en: "The kernel has no MAC address for 192.168.1.1, so it holds the ping and broadcasts an ARP request to every machine on the LAN.",
          id: "Kernel tidak punya alamat MAC untuk 192.168.1.1, jadi ia menahan ping dan menyiarkan request ARP ke semua mesin di LAN.",
          lx: { en: "Kernel. ip neigh shows 192.168.1.1 as INCOMPLETE while it waits.", id: "Kernel. ip neigh menampilkan 192.168.1.1 sebagai INCOMPLETE selama menunggu." } },
        { at: "switch", l: 2, pkt: [c(2, "ETH aa:..:10 → ff:ff:ff:ff:ff:ff"), c(2, "ARP who-has 192.168.1.1")], read: [0],
          en: "ff:ff:ff:ff:ff:ff is the broadcast address, so the switch copies the frame out of every port. It also learns which port aa:..:10 is behind.",
          id: "ff:ff:ff:ff:ff:ff adalah alamat broadcast, jadi switch menyalin frame ke semua port. Switch juga mempelajari port tempat aa:..:10 berada.",
          lx: { en: "bridge fdb show lists what a Linux bridge has learned.", id: "bridge fdb show menampilkan apa yang sudah dipelajari bridge Linux." } },
        { at: "R", l: 2, dir: "down", pkt: [c(2, "ETH aa:..:01 → aa:..:10"), c(2, "ARP 192.168.1.1 is-at aa:..:01")],
          en: "The router sees its own IP in the request and replies directly to the laptop with its MAC address.",
          id: "Router melihat IP miliknya di request itu dan membalas langsung ke laptop dengan alamat MAC-nya.",
          lx: { en: "Kernel. Linux answers ARP by itself, no program is involved.", id: "Kernel. Linux menjawab ARP sendiri, tanpa melibatkan program apa pun." } },
        { at: "L", l: 2, pkt: [c(2, "ETH aa:..:10 → aa:..:01"), c(3, "IP 192.168.1.10 → 192.168.1.1"), c(3, "ICMP echo request seq=1")],
          en: "The laptop saves the answer and sends the waiting ping in a normal Ethernet frame addressed to the router's MAC.",
          id: "Laptop menyimpan jawabannya dan mengirim ping yang tertunda dalam frame Ethernet biasa yang ditujukan ke MAC router.",
          lx: { en: "Kernel. ip neigh now shows 192.168.1.1 lladdr aa:..:01 REACHABLE.", id: "Kernel. ip neigh sekarang menampilkan 192.168.1.1 lladdr aa:..:01 REACHABLE." } },
        { at: "switch", l: 2, pkt: [c(2, "ETH aa:..:10 → aa:..:01"), c(3, "IP"), c(3, "ICMP echo request")], read: [0],
          en: "The switch learned the router's port from the ARP reply, so this frame goes out of one port only.",
          id: "Switch sudah mempelajari port router dari balasan ARP, jadi frame ini keluar dari satu port saja.",
          lx: { en: "Same job as a Linux bridge forwarding table.", id: "Sama seperti tabel forwarding bridge Linux." } },
        { at: "R", l: 3, dir: "up", pkt: [c(3, "IP 192.168.1.1 → 192.168.1.10"), c(3, "ICMP echo reply seq=1")],
          en: "The router's kernel sees an echo request for its own IP and sends an echo reply. No program runs on the router for this.",
          id: "Kernel router melihat echo request untuk IP miliknya dan mengirim echo reply. Tidak ada program yang berjalan di router untuk ini.",
          lx: { en: "Kernel. Setting net.ipv4.icmp_echo_ignore_all=1 makes Linux stop answering pings.", id: "Kernel. Mengatur net.ipv4.icmp_echo_ignore_all=1 membuat Linux berhenti menjawab ping." } },
        { at: "L", l: 3, dir: "up", pkt: [c(3, "ICMP echo reply seq=1")], read: [0],
          en: "ping prints \"64 bytes from 192.168.1.1: icmp_seq=1 time=0.55 ms\". This proves layers 1 to 3 work between the two machines. It says nothing about TCP ports, TLS, or HTTP.",
          id: "ping mencetak \"64 bytes from 192.168.1.1: icmp_seq=1 time=0.55 ms\". Ini membuktikan layer 1 sampai 3 berjalan di antara kedua mesin. Ini tidak membuktikan apa pun soal port TCP, TLS, atau HTTP.",
          lx: { en: "User space. The ping program reads the reply from its ICMP socket.", id: "User space. Program ping membaca balasan dari socket ICMP-nya." } },
      ],
    },
    dns: {
      left: { en: "Laptop 192.168.1.10", id: "Laptop 192.168.1.10" },
      right: { en: "DNS resolver 1.1.1.1", id: "Resolver DNS 1.1.1.1" },
      devices: ["switch", "router"],
      intro: {
        en: "The browser needs the IP address of example.com before it can connect.",
        id: "Browser butuh alamat IP example.com sebelum bisa tersambung.",
      },
      steps: [
        { at: "L", l: 7, pkt: [c(7, "DNS query id=0x1a2b  A example.com?")],
          en: "The program calls getaddrinfo(\"example.com\"). A DNS query is a small binary message asking for the A record (IPv4 address).",
          id: "Program memanggil getaddrinfo(\"example.com\"). Query DNS adalah pesan biner kecil yang menanyakan record A (alamat IPv4).",
          lx: { en: "User space. glibc asks systemd-resolved on 127.0.0.53, which asks the upstream resolver shown in resolvectl status.", id: "User space. glibc bertanya ke systemd-resolved di 127.0.0.53, yang bertanya ke resolver upstream di resolvectl status." } },
        { at: "L", l: 6, pkt: [c(7, "DNS query id=0x1a2b  A example.com?")],
          en: "Plain DNS has no encryption and no session, so layers 6 and 5 add nothing. Anyone on the path can read which names you look up. DNS over TLS or HTTPS adds encryption here.",
          id: "DNS biasa tidak punya enkripsi dan tidak punya sesi, jadi layer 6 dan 5 tidak menambah apa pun. Siapa pun di jalur bisa membaca nama yang kamu cari. DNS over TLS atau HTTPS menambahkan enkripsi di sini.",
          lx: { en: "resolvectl status shows whether DNSOverTLS is on.", id: "resolvectl status menunjukkan apakah DNSOverTLS menyala." } },
        { at: "L", l: 4, pkt: [c(4, "UDP :53001 → :53"), c(7, "DNS query A example.com?")],
          en: "The kernel adds an 8-byte UDP header. There is no handshake. The first packet already carries the question.",
          id: "Kernel menambahkan header UDP 8 byte. Tidak ada handshake. Paket pertama langsung membawa pertanyaannya.",
          lx: { en: "Kernel. sendto() on a UDP socket. The kernel keeps no copy for resending.", id: "Kernel. sendto() pada socket UDP. Kernel tidak menyimpan salinan untuk dikirim ulang." } },
        { at: "L", l: 3, pkt: [c(3, "IP 192.168.1.10 → 1.1.1.1 TTL 64"), c(4, "UDP :53001 → :53"), c(7, "DNS query")],
          en: "The kernel adds the IP header. 1.1.1.1 is not local, so the packet goes via the default gateway.",
          id: "Kernel menambahkan header IP. 1.1.1.1 tidak lokal, jadi paketnya lewat default gateway.",
          lx: { en: "Kernel. ip route get 1.1.1.1", id: "Kernel. ip route get 1.1.1.1" } },
        { at: "L", l: 2, pkt: [c(2, "ETH aa:..:10 → aa:..:01"), c(3, "IP → 1.1.1.1"), c(4, "UDP → :53"), c(7, "DNS query"), c(2, "FCS")],
          en: "The Ethernet header is addressed to the router's MAC, which the kernel already has in its ARP table.",
          id: "Header Ethernet ditujukan ke MAC router, yang sudah ada di tabel ARP kernel.",
          lx: { en: "Kernel and driver.", id: "Kernel dan driver." } },
        { at: "router", l: 3, pkt: [c(2, "ETH (new)"), c(3, "IP 203.0.113.7 → 1.1.1.1 TTL 63"), c(4, "UDP :40001 → :53"), c(7, "DNS query")], read: [1, 2],
          en: "The router applies NAT and rewrites the source IP and port. It remembers the mapping so the answer can find its way back, even though UDP has no connection.",
          id: "Router menerapkan NAT dan menulis ulang IP dan port sumber. Ia mengingat pemetaan itu supaya jawabannya bisa kembali, walaupun UDP tidak punya koneksi.",
          lx: { en: "On a Linux router, conntrack keeps this mapping. conntrack -L lists it.", id: "Di router Linux, conntrack menyimpan pemetaan ini. conntrack -L menampilkannya." } },
        { at: "R", l: 4, pkt: [c(4, "UDP :40001 → :53"), c(7, "DNS query A example.com?")], read: [0],
          en: "At the resolver, the kernel removes the lower headers. Port 53 leads to the resolver program.",
          id: "Di resolver, kernel melepas header bawah. Port 53 mengarah ke program resolver.",
          lx: { en: "Kernel, then the resolver process (for example unbound or BIND on Linux).", id: "Kernel, lalu proses resolver (misalnya unbound atau BIND di Linux)." } },
        { at: "R", l: 7, dir: "down", pkt: [c(7, "DNS answer id=0x1a2b  example.com A 198.51.100.20 TTL 300")], read: [0],
          en: "The resolver answers with the IP address and a TTL of 300 seconds, which says how long the answer may be cached. The reply goes back down the layers.",
          id: "Resolver menjawab dengan alamat IP dan TTL 300 detik, yang menentukan berapa lama jawabannya boleh disimpan di cache. Balasannya turun lagi melewati lapisan.",
          lx: { en: "User space. This DNS TTL is a layer 7 field, unrelated to the IP TTL at layer 3.", id: "User space. TTL DNS ini field layer 7, tidak ada hubungannya dengan TTL IP di layer 3." } },
        { at: "L", l: 7, dir: "up", pkt: [c(7, "example.com → 198.51.100.20")], read: [0],
          en: "The answer arrives and getaddrinfo() returns. If a UDP packet had been lost, the kernel would not resend it. The resolver retries after its own timeout (5 seconds in glibc by default). Now the HTTPS scenario can start.",
          id: "Jawabannya tiba dan getaddrinfo() kembali. Kalau paket UDP-nya hilang, kernel tidak akan mengirim ulang. Resolver mencoba lagi setelah timeout-nya sendiri (bawaannya 5 detik di glibc). Sekarang skenario HTTPS bisa dimulai.",
          lx: { en: "User space. resolvectl statistics shows cache hits.", id: "User space. resolvectl statistics menampilkan cache hit." } },
      ],
    },
  };

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  document.querySelectorAll(".osi-sim").forEach((root) => {
    const lang = root.dataset.simLang === "id" ? "id" : "en";
    const t = T[lang];

    const bar = el("div", "osi-sim__bar");
    const select = el("select");
    select.setAttribute("aria-label", t.scenario);
    Object.keys(SCENARIOS).forEach((key) => select.appendChild(new Option(t.names[key], key)));
    const back = el("button", null, `◀ ${t.back}`);
    const next = el("button", null, `${t.next} ▶`);
    const play = el("button", null, t.play);
    const reset = el("button", null, t.reset);
    const count = el("span", "osi-sim__count");
    [back, next, play, reset].forEach((b) => (b.type = "button"));
    bar.append(select, back, next, play, reset, count);

    const makeStack = () => {
      const wrap = el("div");
      const title = el("div", "osi-sim__title");
      const stack = el("div", "osi-sim__stack");
      const rows = {};
      for (let l = 7; l >= 1; l -= 1) {
        const row = el("div", "osi-sim__layer");
        row.dataset.l = String(l);
        row.append(el("b", null, `L${l}`), el("span", null, LAYERS[l]));
        rows[l] = row;
        stack.append(row);
      }
      wrap.append(title, stack);
      return { wrap, title, rows };
    };
    const left = makeStack();
    const right = makeStack();
    const net = el("div", "osi-sim__net");
    const stage = el("div", "osi-sim__stage");
    stage.append(left.wrap, net, right.wrap);

    const where = el("div", "osi-sim__where");
    const packet = el("div", "osi-sim__packet");
    const note = el("div", "osi-sim__note");
    note.setAttribute("aria-live", "polite");
    const linux = el("div", "osi-sim__linux");
    root.append(bar, stage, where, packet, note, linux);

    let pos = 0;
    let timer = null;

    const stop = () => {
      clearInterval(timer);
      timer = null;
      play.textContent = t.play;
    };

    const render = () => {
      const sc = SCENARIOS[select.value];
      left.title.textContent = sc.left[lang];
      right.title.textContent = sc.right[lang];
      net.replaceChildren();
      const devs = {};
      sc.devices.forEach((d) => {
        net.append(el("div", "osi-sim__wire"));
        const box = el("div", "osi-sim__dev", t.devices[d]);
        box.append(el("small", null, d === "switch" ? "L1-L2" : "L1-L3"));
        devs[d] = box;
        net.append(box);
      });
      net.append(el("div", "osi-sim__wire"));

      [left, right].forEach((s) => Object.values(s.rows).forEach((r) => r.classList.remove("is-active", "is-done")));
      const step = pos > 0 ? sc.steps[pos - 1] : null;
      packet.replaceChildren();
      if (!step) {
        where.textContent = "";
        note.textContent = sc.intro[lang];
        linux.textContent = t.start;
      } else {
        if (step.at === "L" || step.at === "R") {
          const side = step.at === "L" ? left : right;
          side.rows[step.l].classList.add("is-active");
          const dir = step.dir || (step.at === "L" ? "down" : "up");
          for (let l = 1; l <= 7; l += 1) {
            if ((dir === "down" && l > step.l && l <= (sc.top || 7)) || (dir === "up" && l < step.l)) side.rows[l].classList.add("is-done");
          }
          where.textContent = `${sc[step.at === "L" ? "left" : "right"][lang]} · L${step.l} ${LAYERS[step.l]} · ${t[dir]}`;
        } else {
          devs[step.at].classList.add("is-active");
          where.textContent = `${t.devices[step.at]} · L${step.l} ${LAYERS[step.l]} · ${t.transit}`;
        }
        step.pkt.forEach((chip, i) => {
          const node = el("span", "osi-sim__chip");
          node.dataset.l = String(chip.l);
          node.append(el("i", null, `L${chip.l}`), document.createTextNode(typeof chip.t === "string" ? chip.t : chip.t[lang]));
          if (step.read && step.read.includes(i)) node.classList.add("is-read");
          packet.append(node);
        });
        note.textContent = step[lang];
        linux.replaceChildren(el("b", null, `${t.linux} `), document.createTextNode(step.lx[lang]));
      }
      Object.values(devs).forEach((d) => d.classList.toggle("is-active", !!step && devs[step.at] === d));
      count.textContent = `${t.step} ${pos} / ${sc.steps.length}`;
      back.disabled = pos === 0;
      next.disabled = pos === sc.steps.length;
      play.disabled = pos === sc.steps.length;
    };

    const advance = () => {
      const total = SCENARIOS[select.value].steps.length;
      if (pos < total) pos += 1;
      if (pos === total) stop();
      render();
    };

    next.addEventListener("click", () => { stop(); advance(); });
    back.addEventListener("click", () => { stop(); pos = Math.max(0, pos - 1); render(); });
    reset.addEventListener("click", () => { stop(); pos = 0; render(); });
    select.addEventListener("change", () => { stop(); pos = 0; render(); });
    play.addEventListener("click", () => {
      if (timer) return stop();
      play.textContent = t.pause;
      advance();
      timer = setInterval(advance, 2200);
    });

    render();
  });
})();
</script>
