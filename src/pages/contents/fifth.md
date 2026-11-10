---
layout: ../../layouts/ContentLayout.astro
title: "TCP: Lapisan Transport dari Handshake sampai Kernel Linux"
title_en: "TCP: The Transport Layer from Handshake to the Linux Kernel"
description: Di mana TCP berada, apa isi header-nya, handshake, retransmisi, state machine, kapan memakainya, simulasi interaktif, dan cara kernel Linux menjalankannya di balik socket.
description_en: Where TCP sits, what is in its header, the handshake, retransmission, the state machine, when to use it, an interactive simulation, and how the Linux kernel runs it behind a socket.
date: 2026-11-10
tags:
  - linux
  - networking
  - tcp
  - kernel
  - notes
---

<div data-lang="en" hidden>

## Where TCP sits

Networking is done in layers. Each layer does one job, adds its own header, and hands the packet to the layer below.

```
 OSI model            TCP/IP model        examples
 ───────────────      ──────────────      ──────────────────────────
 7 Application   ┐
 6 Presentation  ├──► Application         HTTP, SSH, DNS, TLS
 5 Session       ┘
 4 Transport     ───► Transport           TCP, UDP, QUIC (over UDP)   ◄── this post
 3 Network       ───► Internet            IP, ICMP
 2 Data link     ┐
 1 Physical      ┴──► Link                Ethernet, Wi-Fi, ARP
```

TCP is layer 4, the transport layer. IP (layer 3) moves a packet from one machine to another, with no promise that it arrives, arrives once, or arrives in order. TCP runs on top of IP. It numbers the bytes, waits for acknowledgments, and resends what goes missing, so two programs get a reliable byte stream.

This is what one TCP packet looks like on an Ethernet cable, with each layer's header in front of the data:

```
 ┌──────────┬──────────┬───────────┬──────────────────────────┬─────┐
 │ Ethernet │    IP    │    TCP    │        your data         │ FCS │
 │   14 B   │   20 B   │  20-60 B  │  up to MSS, often 1460 B │ 4 B │
 └──────────┴──────────┴───────────┴──────────────────────────┴─────┘
  which NIC   which      which program,
  on the link machine    where in the stream
```

| Layer     | Address it uses        | Question it answers              |
| --------- | ---------------------- | -------------------------------- |
| Link      | MAC address            | Which network card on this cable or Wi-Fi? |
| Internet  | IP address             | Which machine, anywhere?         |
| Transport | Port number            | Which program on that machine?   |
| Application | URL, hostname, path  | What does the message mean?      |

What TCP promises:

- Every byte arrives, or the connection reports an error.
- Bytes arrive in the order they were sent, with no duplicates.
- The sender slows down when the receiver is busy (flow control).
- The sender slows down when the network is full (congestion control).

What TCP does **not** give you:

- Message boundaries. Two `write()` calls of 100 bytes can arrive as one `read()` of 200 bytes, or as 150 + 50. Your protocol must mark where a message ends (a length prefix, a newline, HTTP's `Content-Length`).
- Low latency under loss. A lost packet blocks every byte behind it until the sender resends it.
- Security. Anyone on the path can read and change TCP traffic. TLS, running on top of TCP, adds encryption.

## The TCP header

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Source Port          |       Destination Port        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Sequence Number                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Acknowledgment Number                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Data |       |C|E|U|A|P|R|S|F|                               |
| Offset| Rsrvd |W|C|R|C|S|S|Y|I|            Window             |
|       |       |R|E|G|K|H|T|N|N|                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|           Checksum            |         Urgent Pointer        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Options (0 to 40 bytes)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field              | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| Source / Destination Port | 16 bits each, so 0 to 65535. Picks the program.             |
| Sequence Number    | Position of the first data byte in this segment, counted in bytes. |
| Acknowledgment Number | "I have every byte before this one. Send this one next."        |
| Data Offset        | Header length in 32-bit words (5 = 20 bytes, 15 = 60 bytes).       |
| `SYN`              | "Let's start. My first sequence number is this."                   |
| `ACK`              | The acknowledgment number is valid. Set on almost every packet after the first. |
| `FIN`              | "I have no more data to send."                                     |
| `RST`              | "This connection does not exist. Stop." Aborts at once.            |
| `PSH`              | "Hand this to the application now." Usually set on the last segment of a write. |
| `ECE` / `CWR`      | Explicit Congestion Notification, a router marks instead of dropping. |
| Window             | How many more bytes the receiver can buffer right now.            |
| Checksum           | Detects corrupted segments. A bad one is dropped silently.        |
| Options            | Negotiated in the SYN: `mss`, `wscale`, `sackOK`, timestamps.      |

The window field is only 16 bits (64 KB max), which is too small for fast links. The window scale option (`wscale 7` means multiply by 2^7 = 128) fixes that. You will see all four options in every `tcpdump` of a SYN.

## Ports, sockets, and the 4-tuple

Four values identify a TCP connection:

```
 (source IP, source port, destination IP, destination port)
  10.0.0.1   51234        10.0.0.2         443
```

The server's side is fixed (`10.0.0.2:443`). The client's port is an **ephemeral port** that the kernel picks from `net.ipv4.ip_local_port_range` (32768 to 60999 by default). Since any of the four values can differ, one server port can hold hundreds of thousands of connections at once. Each connection gets its own socket.

A socket is the kernel object for one end of a connection. To your program it is just a file descriptor, a small integer such as `3`.

## Opening a connection: the three-way handshake

```
   client                                          server
 (CLOSED)                                        (LISTEN)
    │ ── SYN  seq=1000 ──────────────────────────────► │
 SYN-SENT                                     SYN-RECEIVED
    │ ◄──────────────────── SYN+ACK seq=5000 ack=1001 │
 ESTABLISHED                                          │
    │ ── ACK  ack=5001 ──────────────────────────────► │
    │                                           ESTABLISHED
```

1. The client sends `SYN` with a random **initial sequence number** (ISN). The ISN is random so an attacker cannot guess it and inject fake packets.
2. The server answers `SYN+ACK` with its own ISN. `ack=1001` means "I got your byte 1000". A SYN counts as one byte even though it carries no data.
3. The client sends `ACK`. Both sides are now `ESTABLISHED`.

Each side has its own sequence numbers, because a TCP connection is two independent byte streams, one in each direction. The handshake costs one round trip before any data moves. On a 100 ms link, that is 100 ms of waiting, and TLS adds at least one more round trip on top. Reusing connections (HTTP keep-alive, connection pools) skips that wait on every request after the first.

## Moving data: sequence numbers, ACKs, and windows

```
 client                                   server
   │ ── seq=1001 len=1000 ──────────────────► │
   │ ── seq=2001 len=1000 ──────────────────► │
   │ ◄─────────────────────────── ack=3001 ── │   "I have everything up to 3000"
```

ACKs are cumulative. `ack=3001` confirms every byte before 3001, so one ACK can cover many segments. Linux also delays ACKs a little and acknowledges every second segment, which halves the ACK traffic.

The sender can have this much unacknowledged data in flight:

```
 in flight ≤ min(rwnd, cwnd)
             │      └── congestion window: the sender's guess of what the NETWORK can take
             └── receive window: what the RECEIVER said it can buffer (the Window field)
```

**Flow control** (`rwnd`) protects the receiver. If your program stops calling `read()`, the receive buffer fills, the advertised window drops to 0, and the sender stops. This is a "zero window", and `tcpdump` shows it as `win 0`.

**Congestion control** (`cwnd`) protects the network. A new connection starts with `cwnd` = 10 segments (about 14 KB), then roughly doubles it every round trip (slow start) until it sees loss. After a loss it backs off and grows slowly. Linux uses CUBIC by default. BBR is the other common choice. It measures bandwidth and RTT instead of treating every loss as congestion, so it keeps a higher speed on long or lossy links.

```bash
sysctl net.ipv4.tcp_congestion_control             # cubic
sysctl net.ipv4.tcp_available_congestion_control   # reno cubic (bbr after modprobe tcp_bbr)
```

### When a packet is lost

TCP finds out about loss in two ways:

- **Duplicate ACKs.** The receiver keeps sending the same `ack` number, because one segment is missing and it cannot acknowledge past it. After three duplicates the sender resends the missing segment right away. This is **fast retransmit**. The SACK option tells the sender exactly which blocks arrived, so it resends only the missing one. Modern Linux also uses RACK, which detects loss by time ("a segment sent after this one was ACKed long ago") instead of by counting duplicates.
- **Retransmission timeout (RTO).** If no ACK arrives at all, a timer fires. The RTO is based on measured RTT, with a 200 ms minimum on Linux and 1 second before any RTT is known. Each timeout doubles the wait.

The application never sees any of this. It only sees `read()` taking a little longer.

## Closing: FIN, TIME-WAIT, and RST

```
   client (closes first)                           server
 ESTABLISHED                                    ESTABLISHED
    │ ── FIN  seq=1101 ──────────────────────────────► │
 FIN-WAIT-1                                     CLOSE-WAIT   ◄── server's read() returns 0
    │ ◄───────────────────────────────── ACK ack=1102 │
 FIN-WAIT-2                                           │      (the server may still send)
    │ ◄───────────────────────────────── FIN seq=5301 │      ◄── server app calls close()
 TIME-WAIT                                       LAST-ACK
    │ ── ACK  ack=5302 ──────────────────────────────► │
    │    (waits 60 s)                             CLOSED
 CLOSED
```

Each direction closes on its own, so a normal close takes four packets. The side that sends `FIN` first is the **active closer**, and it ends up in `TIME-WAIT`.

`TIME-WAIT` lasts 60 seconds on Linux, a value fixed in the kernel source. It exists for two reasons. If the last `ACK` is lost, the peer resends its `FIN`, and the closer must still remember the connection to ACK it again. It also stops a delayed packet from this connection from landing in a new connection that reuses the same 4-tuple.

`RST` aborts a connection at once, with no close sequence. The kernel sends it when:

- a SYN arrives for a port where nothing listens, which your program sees as "Connection refused",
- a packet arrives for a connection the kernel does not know, for example after a reboot,
- a program calls `close()` while unread data is still in its receive buffer,
- a firewall rule says `reject with tcp reset`.

## The state machine

```
                     connect() / send SYN
           ┌──────────────────────────────────────► SYN-SENT ──────────────┐
           │                                                               │ got SYN+ACK
       CLOSED                                                              │ send ACK
           │  listen()                got SYN                              ▼
           └─────────────► LISTEN ─────────────► SYN-RECEIVED ──────► ESTABLISHED
                                   send SYN+ACK              got ACK       │
                                                                           │
            we close first:   FIN-WAIT-1 ──► FIN-WAIT-2 ──► TIME-WAIT ──(60 s)──► CLOSED
            peer closes first: CLOSE-WAIT ──(our close())──► LAST-ACK ──► CLOSED
```

| State          | Meaning                                      | Worry when                                  |
| -------------- | -------------------------------------------- | ------------------------------------------- |
| `LISTEN`       | Server socket waiting for SYNs.               | It is missing. Nothing will accept connections. |
| `SYN-SENT`     | Client sent SYN, no answer yet.               | It lasts. Something drops your SYN.         |
| `SYN-RECEIVED` | Server got SYN, sent SYN+ACK, waits for ACK.  | Thousands of them. Possible SYN flood.      |
| `ESTABLISHED`  | Open, data can flow both ways.                | Never, it is the normal state.              |
| `FIN-WAIT-1/2` | We closed, waiting for the peer to close.     | Many `FIN-WAIT-2`. The peer never closes its side. |
| `CLOSE-WAIT`   | Peer closed, **our program has not called `close()`**. | It grows. This is a bug in your code. |
| `LAST-ACK`     | We closed after the peer, waiting for its ACK. | Rarely an issue.                          |
| `TIME-WAIT`    | We closed first, waiting 60 s.                | Only if you run out of ephemeral ports.     |

`ss -tan` shows these states. `ss` names `ESTABLISHED` as `ESTAB` and `SYN-RECEIVED` as `SYN-RECV`.

## Simulation

Pick a scenario and step through it. Each arrow is one packet. The boxes show each side's TCP state after the packet, and the bottom panel shows roughly what `tcpdump` would print.

<div class="tcp-sim" data-sim-lang="en"></div>

Things to notice:

- In the normal scenario, no application code runs during the handshake. Both kernels finish it before `accept()` returns.
- In the packet loss scenario, the server holds segments 3 to 5 but cannot give them to the application until the client resends segment 2. This is **head-of-line blocking**.
- The refused scenario fails in one round trip. The dropped scenario takes about two minutes. When a connection hangs instead of failing fast, look for a firewall that drops packets.

## TCP runs in the kernel

Your program never builds a TCP packet. TCP runs inside the operating system kernel. Your program asks the kernel for a socket and reads and writes bytes through system calls. The kernel handles sequence numbers, ACKs, timers, retransmission, and congestion control.

```python
import socket

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)    # socket(): new file descriptor
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # can restart while old sockets sit in TIME-WAIT
srv.bind(("0.0.0.0", 9000))                                # bind(): claim port 9000
srv.listen(128)                                            # listen(): kernel now answers SYNs by itself

while True:
    conn, addr = srv.accept()   # accept(): take one finished handshake from the accept queue
    data = conn.recv(4096)      # recv(): copy bytes out of the kernel's receive buffer
    conn.sendall(data)          # send(): copy bytes into the kernel's send buffer
    conn.close()                # close(): kernel sends FIN
```

| System call       | Sent on the wire           | What the kernel does                                      |
| ----------------- | -------------------------- | --------------------------------------------------------- |
| `socket()`        | nothing                    | Creates the socket and returns a file descriptor.         |
| `bind()`          | nothing                    | Reserves the address and port, or fails with `EADDRINUSE`. |
| `listen(backlog)` | nothing                    | Marks the socket `LISTEN` and sizes its accept queue.     |
| `connect()`       | SYN, then ACK              | Runs the handshake. Returns when `ESTABLISHED`, or fails with `ECONNREFUSED` or `ETIMEDOUT`. |
| `accept()`        | nothing                    | Takes a finished connection off the accept queue and returns a new descriptor for it. |
| `write()` / `send()` | data, now or later      | Copies bytes into the send buffer and returns. Blocks only when the buffer is full. |
| `read()` / `recv()` | sometimes a window update | Copies bytes out of the receive buffer. Returns 0 once the peer sent FIN. |
| `shutdown(SHUT_WR)` | FIN                      | Closes only your sending direction. You can still read.   |
| `close()`         | FIN, or RST if unread data remains | Releases the descriptor. The kernel finishes the close in the background. |

A successful `write()` only means the kernel copied your bytes. It does not mean the other side received them. If the peer crashes a second later, you find out on a later `write()` or `read()`.

You can watch these calls with `strace`:

```bash
strace -e trace=socket,connect,sendto,recvfrom python3 -c '
import socket
s = socket.create_connection(("127.0.0.1", 8765))
s.sendall(b"GET / HTTP/1.0\r\n\r\n")
s.recv(100)'
```

```
socket(AF_INET, SOCK_STREAM|SOCK_CLOEXEC, IPPROTO_TCP) = 3
connect(3, {sa_family=AF_INET, sin_port=htons(8765), sin_addr=inet_addr("127.0.0.1")}, 16) = 0
sendto(3, "GET / HTTP/1.0\r\n\r\n", 18, 0, NULL, 0) = 18
recvfrom(3, "HTTP/1.0 200 OK\r\nServer: SimpleH"..., 100, 0, NULL, NULL) = 100
```

The `3` is the file descriptor. A socket is a file to Linux, so `ls -l /proc/<pid>/fd` lists it as `socket:[123456]`, and `ss -tp` maps it back to the process.

### The two queues behind `listen()`

```
             SYN                         final ACK                       accept()
 client ───────────► SYN queue ─────────────────────► accept queue ─────────────► your program
                     half-open connections            finished handshakes
                     (tcp_max_syn_backlog)            limit: min(backlog, net.core.somaxconn)
```

The kernel completes handshakes even when your program is busy. Finished connections wait in the accept queue until `accept()` takes them. If the accept queue is full, Linux drops the final ACK and new SYNs, and clients sit in `SYN-SENT` while they retry. `nstat` counts these drops as `TcpExtListenOverflows`. Under a SYN flood, SYN cookies (`net.ipv4.tcp_syncookies = 1`) let the server answer without storing anything in the SYN queue.

### The path of one packet through Linux

```
          SENDING                                         RECEIVING
 user     write(fd, buf)                                  read(fd, buf)
 ─────────────│─────────────────── syscall ─────────────────────▲─────────────
 kernel       ▼                                                 │
        socket send buffer (tcp_wmem)               socket receive buffer (tcp_rmem)
              ▼                                                 ▲
        TCP: cut into segments, seq numbers,        TCP: check seq, reorder,
             cwnd, retransmit timers                     send ACKs, update window
              ▼                                                 ▲
        IP: choose route, add IP header             IP: is this packet for me?
              ▼                                                 ▲
        netfilter: output, postrouting              netfilter: prerouting, input
              ▼                                                 ▲
        qdisc (tc): queue, shape, delay             GRO: merge small segments
              ▼                                                 ▲
        driver ──► NIC ──► wire ═══════════════════► NIC ──► interrupt, NAPI poll
```

- netfilter is where nftables rules run. A `drop` rule there sends nothing back, so `connect()` hangs until it times out. See the nftables post for the hooks.
- qdisc is the transmit queue. `tc` controls it, and `netem` can add fake delay and loss there, which the lab below uses.
- Offloads (TSO, GSO, GRO) let the kernel hand the network card one 64 KB chunk and let the card cut it into 1460-byte segments. This is why `tcpdump` sometimes shows a "packet" much larger than the MTU. `ethtool -k eth0` lists them.

The kernel shows its TCP internals in a few places:

```bash
ss -tan                        # every TCP socket and its state
ss -ti                         # plus internals: rtt, cwnd, retransmits
nstat -az | grep -i tcp        # kernel TCP counters (retransmits, drops, resets)
cat /proc/net/tcp              # raw socket table, what ss reads (hex)
sysctl -a | grep net.ipv4.tcp  # all tuning knobs
```

### Linux and other operating systems

Linux, Windows, macOS, and the BSDs each have their own TCP code. All of them expose the same Berkeley sockets API (`socket`, `bind`, `listen`, `accept`, `connect`, `send`, `recv`). That is why the same Python or Go program runs on all of them unchanged.

| OS      | Where TCP lives                       | How you tune it                   |
| ------- | ------------------------------------- | --------------------------------- |
| Linux   | kernel, `net/ipv4/tcp*.c`             | `sysctl net.ipv4.tcp_*`, `ss`, `tc` |
| Windows | kernel driver `tcpip.sys`, Winsock API | `netsh int tcp`, PowerShell `Get-NetTCPConnection` |
| macOS   | XNU kernel, BSD-derived stack         | `sysctl net.inet.tcp.*`, `netstat` |

The protocol on the wire is the same everywhere, so a Windows client talks to a Linux server with no special handling. Defaults differ, such as initial windows, TIME-WAIT length, and keepalive timers. Windows and macOS also use CUBIC by default.

Two exceptions skip the kernel's TCP. QUIC (used by HTTP/3) runs in the application's own process on top of UDP, so browsers can ship new versions without waiting for an OS update. Kernel-bypass libraries such as DPDK run a TCP stack in user space for very high packet rates.

## When to use TCP, and when not

| Use TCP when                                 | Use UDP when                                    |
| -------------------------------------------- | ----------------------------------------------- |
| Every byte matters: files, web pages, APIs   | Late data is useless: voice, video calls, games |
| Order matters: database queries, SSH sessions | Messages are small and independent: DNS, NTP   |
| You want the OS to handle retries for you    | You need to send to many hosts at once (multicast) |
| Long-lived connections: HTTP/1.1, HTTP/2, gRPC | You build your own reliability, like QUIC     |

Common protocols and their transport:

| Protocol             | Transport | Why                                              |
| -------------------- | --------- | ------------------------------------------------ |
| HTTP/1.1, HTTP/2     | TCP       | Pages and API responses must be complete.        |
| HTTP/3               | QUIC on UDP | Avoids TCP head-of-line blocking on lossy mobile links, 0-RTT reconnect. |
| SSH, PostgreSQL, MySQL, Redis | TCP | Commands must arrive once and in order.     |
| DNS                  | UDP, TCP for large answers and zone transfers | One small question, one small answer. |
| WebRTC, VoIP         | UDP       | A frame that arrives 300 ms late is worse than a missing frame. |
| WireGuard            | UDP       | Tunnels TCP inside. TCP over TCP retransmits twice and stalls. |

A common mistake is building a real-time game or video feed on TCP. When one packet is lost, every newer packet waits behind it. With UDP you skip the lost one and use the newest data.

## Hands-on lab on Linux

This lab builds two network namespaces joined by a virtual cable, so you can break the network without touching your real one. Steps 1 to 4 need root. Step 5 does not.

### 1. Set up two namespaces

```bash
sudo ip netns add client
sudo ip netns add server
sudo ip link add veth-c type veth peer name veth-s     # a virtual cable with two ends
sudo ip link set veth-c netns client                    # plug one end into "client"
sudo ip link set veth-s netns server                    # and the other into "server"
sudo ip -n client addr add 10.0.0.1/24 dev veth-c
sudo ip -n server addr add 10.0.0.2/24 dev veth-s
sudo ip -n client link set veth-c up
sudo ip -n server link set veth-s up
sudo ip -n server link set lo up

cl() { sudo ip netns exec client "$@"; }   # run a command inside "client"
sv() { sudo ip netns exec server "$@"; }   # run a command inside "server"

cl ping -c 2 10.0.0.2
```

The two functions work in bash and zsh. Each namespace has its own interfaces, routes, sockets, firewall, and TCP sysctls.

### 2. Watch a handshake

```bash
mkdir -p /tmp/tcplab && head -c 20M /dev/urandom > /tmp/tcplab/blob
sv python3 -m http.server 8080 --bind 10.0.0.2 --directory /tmp/tcplab   # terminal 1
sv tcpdump -ni veth-s tcp port 8080                                     # terminal 2
cl curl -s -o /dev/null http://10.0.0.2:8080/                           # terminal 3
```

The first three lines of the `tcpdump` output are the handshake (trimmed):

```
10.0.0.1.41822 > 10.0.0.2.8080: Flags [S],  seq 3542141823, win 64240, options [mss 1460,sackOK,TS ...,nop,wscale 7], length 0
10.0.0.2.8080 > 10.0.0.1.41822: Flags [S.], seq 1803340530, ack 3542141824, win 65160, options [mss 1460,sackOK,TS ...,nop,wscale 7], length 0
10.0.0.1.41822 > 10.0.0.2.8080: Flags [.],  ack 1, win 502, length 0
```

| `tcpdump` flag | TCP flags        |
| -------------- | ---------------- |
| `[S]`          | SYN              |
| `[S.]`         | SYN+ACK (`.` means ACK) |
| `[.]`          | ACK only         |
| `[P.]`         | PSH+ACK, carries data |
| `[F.]`         | FIN+ACK          |
| `[R]` / `[R.]` | RST              |

After the handshake `tcpdump` shows sequence numbers relative to the ISN (`ack 1`), which is easier to read. Add `-S` to see the absolute values. `win 502` looks tiny, but with `wscale 7` it means 502 × 128 = 64256 bytes.

### 3. Refused, dropped, and rejected

```bash
cl nc -zv 10.0.0.2 9999
# nc: connect to 10.0.0.2 port 9999 (tcp) failed: Connection refused     ← instant, kernel sent RST

sv nft add table inet lab
sv nft add chain inet lab input '{ type filter hook input priority 0; policy accept; }'
sv nft add rule inet lab input tcp dport 9999 drop
sv nft add rule inet lab input tcp dport 9998 reject with tcp reset

cl nc -zv -w 10 10.0.0.2 9999
# hangs, then: nc: connect to 10.0.0.2 port 9999 (tcp) timed out          ← firewall dropped the SYN

cl nc -zv 10.0.0.2 9998
# Connection refused                                                       ← firewall forged the RST
```

Run `sv tcpdump -ni veth-s -ttt tcp port 9999` during the dropped test. `-ttt` prints the time between packets, and the SYN retries come at growing gaps of 1, 2, 4, and 8 seconds. Without `-w`, the kernel stops after `tcp_syn_retries` (6) retries, about 127 seconds in total.

### 4. Add delay and loss

```bash
sv tc qdisc add dev veth-s root netem delay 50ms loss 2%   # slow, lossy cable from the server
cl ping -c 3 10.0.0.2                                      # RTT is now about 50 ms
cl curl -o /dev/null http://10.0.0.2:8080/blob             # note the speed

sv ss -ti 'sport = :8080'                                  # run this during the download
sv nstat -az TcpRetransSegs                                # total retransmitted segments
```

`ss -ti` prints a line like this for each connection (trimmed, your numbers will differ):

```
cubic wscale:7,7 rto:256 rtt:51.2/1.4 mss:1448 cwnd:14 ssthresh:12 ... retrans:0/37 ...
```

| Field          | Meaning                                                  |
| -------------- | -------------------------------------------------------- |
| `cubic`        | Congestion control algorithm for this socket.            |
| `rtt:51.2/1.4` | Smoothed round-trip time and its variation, in ms.       |
| `rto:256`      | Current retransmission timeout, in ms.                   |
| `cwnd:14`      | Congestion window, in segments.                          |
| `ssthresh:12`  | Where slow start ended after the last loss.              |
| `retrans:0/37` | Segments being retransmitted now / in total.             |

Now compare:

```bash
sv tc qdisc change dev veth-s root netem delay 50ms loss 0%    # no loss: much faster
sv tc qdisc change dev veth-s root netem delay 50ms loss 5%    # more loss: much slower

sudo modprobe tcp_bbr
sv sysctl -w net.ipv4.tcp_congestion_control=bbr               # only for the server namespace
cl curl -o /dev/null http://10.0.0.2:8080/blob                 # usually far faster than cubic at 5% loss
```

CUBIC treats each loss as a full queue and cuts its window. With random loss and no real congestion, that cut is wrong. BBR does not read loss as congestion, so random loss slows it far less.

### 5. Fill an accept queue (no root needed)

```bash
python3 -c 'import socket, time
s = socket.socket(); s.bind(("127.0.0.1", 7000)); s.listen(2); time.sleep(60)' &   # listens, never accepts

for i in 1 2 3 4 5 6; do nc 127.0.0.1 7000 </dev/null & done

ss -ltn 'sport = :7000'
ss -tan 'dport = :7000'
nstat -az TcpExtListenOverflows
```

Output on Linux 6.8:

```
State  Recv-Q Send-Q Local Address:Port Peer Address:Port
LISTEN 3      2          127.0.0.1:7000      0.0.0.0:*

State    Recv-Q Send-Q Local Address:Port  Peer Address:Port
ESTAB    0      0          127.0.0.1:60736    127.0.0.1:7000
ESTAB    0      0          127.0.0.1:60746    127.0.0.1:7000
ESTAB    0      0          127.0.0.1:60758    127.0.0.1:7000
SYN-SENT 0      1          127.0.0.1:60770    127.0.0.1:7000
SYN-SENT 0      1          127.0.0.1:60784    127.0.0.1:7000
SYN-SENT 0      1          127.0.0.1:60792    127.0.0.1:7000
```

On a `LISTEN` socket, `Recv-Q` is the number of connections waiting in the accept queue and `Send-Q` is the backlog. Linux allows backlog + 1 entries, so three clients are `ESTAB` even though the program never called `accept()`. The other three stay in `SYN-SENT`, because the kernel drops their SYNs, and `ListenOverflows` counts up.

To see `CLOSE-WAIT`, connect to a server that closes first and never close your end:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 &
python3 -c 'import socket, time
s = socket.create_connection(("127.0.0.1", 8765))
s.send(b"GET / HTTP/1.0\r\n\r\n"); time.sleep(30)' &
ss -tan '( sport = :8765 or dport = :8765 )'
# CLOSE-WAIT 4460 0   127.0.0.1:53154  127.0.0.1:8765    ← our side: peer closed, we never did
# FIN-WAIT-2 0    0   127.0.0.1:8765   127.0.0.1:53154   ← server side: waiting for our FIN
```

### Clean up

```bash
sudo ip netns del client
sudo ip netns del server        # also removes the veth pair, tc rules, and nft tables
kill %1 %2 2>/dev/null; pkill -f 'nc 127.0.0.1 7000'
```

## Troubleshooting by symptom

| Symptom                                     | What you see                              | Cause and fix                                   |
| ------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| "Connection refused" at once                | `RST` in `tcpdump`                        | Nothing listens on that port, or it listens on `127.0.0.1` only. Check `ss -ltn`. |
| Connect hangs, then times out               | Client in `SYN-SENT`, repeated SYNs       | Something drops packets: firewall, security group, wrong route, host down. Run `tcpdump` on both ends. |
| `CLOSE-WAIT` count keeps growing            | `ss -tan state close-wait`                | Your program never calls `close()`. Close sockets in `finally` or `defer`. |
| Thousands of `TIME-WAIT`                    | `ss -tan state time-wait \| wc -l`        | Normal for the side that closes first. Only a problem if ephemeral ports run out. Reuse connections (keep-alive, pools). |
| Clients time out under load                 | `LISTEN` `Recv-Q` at `Send-Q`, `ListenOverflows` rising | The program accepts too slowly. Add workers, raise `listen()` backlog and `net.core.somaxconn`. |
| Small request-response is about 40 ms slow  | Gaps between small segments               | Nagle's algorithm plus delayed ACK. Set `TCP_NODELAY` on the socket. |
| Idle connection dies after minutes          | `RST` or silence after idle time          | A NAT or load balancer forgot the connection. Enable keepalive with a shorter idle time, or send pings in the application. |
| Low throughput on a long-distance link      | `cwnd` or `rwnd` small in `ss -ti`        | Window smaller than bandwidth × RTT. Check `wscale`, raise `tcp_rmem`/`tcp_wmem` max, try BBR. |

The last row is the **bandwidth-delay product**. To fill 1 Gbit/s over 100 ms RTT, 12.5 MB must be in flight. With the default 6 MB maximum receive buffer, one connection tops out near 500 Mbit/s however fast the link is.

## Sysctl cheat sheet

Defaults from Ubuntu 24.04 with kernel 6.8. Read with `sysctl <name>`, change with `sysctl -w <name>=<value>`, make permanent in `/etc/sysctl.d/*.conf`.

| Setting                          | Default            | Controls                                        |
| -------------------------------- | ------------------ | ----------------------------------------------- |
| `net.ipv4.tcp_congestion_control` | `cubic`           | Congestion control algorithm.                   |
| `net.ipv4.tcp_syn_retries`       | `6`                | SYN retries before `connect()` fails (about 127 s). |
| `net.ipv4.tcp_synack_retries`    | `5`                | SYN+ACK retries on the server side.             |
| `net.ipv4.tcp_retries2`          | `15`               | Data retries before an established connection is dropped (about 15 min). |
| `net.core.somaxconn`             | `4096`             | Maximum accept queue for any `listen()`.        |
| `net.ipv4.tcp_max_syn_backlog`   | `1024`             | Maximum SYN queue.                              |
| `net.ipv4.tcp_syncookies`        | `1`                | SYN cookies when the SYN queue overflows.       |
| `net.ipv4.tcp_rmem`              | `4096 131072 6291456` | Receive buffer min, default, max (bytes).    |
| `net.ipv4.tcp_wmem`              | `4096 16384 4194304`  | Send buffer min, default, max (bytes).       |
| `net.ipv4.ip_local_port_range`   | `32768 60999`      | Ephemeral ports for outgoing connections.       |
| `net.ipv4.tcp_tw_reuse`          | `2`                | Reuse `TIME-WAIT` ports for new outgoing connections. 2 = loopback only. |
| `net.ipv4.tcp_fin_timeout`       | `60`               | How long an orphaned socket stays in `FIN-WAIT-2`. Does **not** change `TIME-WAIT`. |
| `net.ipv4.tcp_keepalive_time`    | `7200`             | Idle seconds before the first keepalive probe.  |
| `net.ipv4.tcp_keepalive_intvl`   | `75`               | Seconds between probes.                          |
| `net.ipv4.tcp_keepalive_probes`  | `9`                | Failed probes before the connection is dropped. |

Do not copy tuning lists from blog posts. Most defaults are right for most machines. Change one value when a measurement such as `nstat`, `ss -ti`, or a counter in `/proc/net/netstat` points at it.

## Summary

1. TCP is layer 4. IP finds the machine, the port finds the program, and TCP makes the byte stream reliable.
2. The handshake costs one round trip. Reuse connections.
3. ACKs are cumulative. Lost segments are resent after duplicate ACKs or a timeout, and the data behind them waits.
4. Sending speed is `min(rwnd, cwnd)`. The receiver limits `rwnd` and the network limits `cwnd`.
5. TCP runs in the kernel. Your program only copies bytes in and out of socket buffers.
6. A refusal is fast and means nothing listens. A timeout is slow and means something drops packets.
7. A growing `CLOSE-WAIT` count means your program does not call `close()`. `TIME-WAIT` is normal unless you run out of ephemeral ports.

</div>

<div data-lang="id">

## Di mana TCP berada

Jaringan bekerja dalam lapisan. Tiap lapisan mengerjakan satu tugas, menambahkan header-nya sendiri, lalu menyerahkan paketnya ke lapisan di bawahnya.

```
 Model OSI            Model TCP/IP        contoh
 ───────────────      ──────────────      ──────────────────────────
 7 Application   ┐
 6 Presentation  ├──► Application         HTTP, SSH, DNS, TLS
 5 Session       ┘
 4 Transport     ───► Transport           TCP, UDP, QUIC (di atas UDP)  ◄── tulisan ini
 3 Network       ───► Internet            IP, ICMP
 2 Data link     ┐
 1 Physical      ┴──► Link                Ethernet, Wi-Fi, ARP
```

TCP ada di layer 4, lapisan transport. IP (layer 3) memindahkan paket dari satu mesin ke mesin lain, tanpa janji paketnya sampai, sampai sekali saja, atau sampai berurutan. TCP berjalan di atas IP. TCP memberi nomor pada setiap byte, menunggu acknowledgment, dan mengirim ulang yang hilang, sehingga dua program mendapat aliran byte yang andal.

Begini bentuk satu paket TCP di kabel Ethernet, dengan header tiap lapisan di depan datanya:

```
 ┌──────────┬──────────┬───────────┬──────────────────────────┬─────┐
 │ Ethernet │    IP    │    TCP    │        data kamu         │ FCS │
 │   14 B   │   20 B   │  20-60 B  │ sampai MSS, biasa 1460 B │ 4 B │
 └──────────┴──────────┴───────────┴──────────────────────────┴─────┘
  kartu       mesin      program mana,
  jaringan    mana       posisi di aliran
```

| Lapisan   | Alamat yang dipakai    | Pertanyaan yang dijawab           |
| --------- | ---------------------- | --------------------------------- |
| Link      | Alamat MAC             | Kartu jaringan mana di kabel atau Wi-Fi ini? |
| Internet  | Alamat IP              | Mesin yang mana, di mana pun?     |
| Transport | Nomor port             | Program mana di mesin itu?        |
| Application | URL, hostname, path  | Apa arti pesannya?                |

Yang dijanjikan TCP:

- Setiap byte sampai, atau koneksi melaporkan error.
- Byte sampai sesuai urutan kirim, tanpa duplikat.
- Pengirim melambat saat penerima sibuk (flow control).
- Pengirim melambat saat jaringan penuh (congestion control).

Yang **tidak** diberikan TCP:

- Batas pesan. Dua kali `write()` 100 byte bisa tiba sebagai satu `read()` 200 byte, atau 150 + 50. Protokolmu sendiri yang harus menandai akhir pesan (awalan panjang, newline, `Content-Length` di HTTP).
- Latensi rendah saat ada paket hilang. Satu paket hilang menahan semua byte di belakangnya sampai pengirim mengirimnya ulang.
- Keamanan. Siapa pun di jalur bisa membaca dan mengubah lalu lintas TCP. TLS, yang berjalan di atas TCP, menambahkan enkripsi.

## Header TCP

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Source Port          |       Destination Port        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Sequence Number                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Acknowledgment Number                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Data |       |C|E|U|A|P|R|S|F|                               |
| Offset| Rsrvd |W|C|R|C|S|S|Y|I|            Window             |
|       |       |R|E|G|K|H|T|N|N|                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|           Checksum            |         Urgent Pointer        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Options (0 to 40 bytes)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field              | Arti                                                               |
| ------------------ | ------------------------------------------------------------------ |
| Source / Destination Port | Masing-masing 16 bit, jadi 0 sampai 65535. Menentukan program. |
| Sequence Number    | Posisi byte data pertama di segmen ini, dihitung per byte.         |
| Acknowledgment Number | "Aku sudah punya semua byte sebelum ini. Kirim yang ini berikutnya." |
| Data Offset        | Panjang header dalam word 32 bit (5 = 20 byte, 15 = 60 byte).      |
| `SYN`              | "Ayo mulai. Nomor urut pertamaku ini."                             |
| `ACK`              | Nomor acknowledgment berlaku. Ada di hampir semua paket setelah yang pertama. |
| `FIN`              | "Aku tidak punya data lagi untuk dikirim."                         |
| `RST`              | "Koneksi ini tidak ada. Berhenti." Langsung memutus.               |
| `PSH`              | "Serahkan ke aplikasi sekarang." Biasanya ada di segmen terakhir dari satu write. |
| `ECE` / `CWR`      | Explicit Congestion Notification, router memberi tanda alih-alih membuang paket. |
| Window             | Berapa byte lagi yang masih bisa ditampung penerima saat ini.      |
| Checksum           | Mendeteksi segmen rusak. Segmen rusak dibuang diam-diam.           |
| Options            | Disepakati di SYN: `mss`, `wscale`, `sackOK`, timestamp.           |

Field window cuma 16 bit (maksimal 64 KB), terlalu kecil untuk link cepat. Opsi window scale (`wscale 7` artinya dikali 2^7 = 128) mengatasinya. Keempat opsi ini selalu terlihat di `tcpdump` setiap SYN.

## Port, socket, dan 4-tuple

Satu koneksi TCP dikenali dari empat nilai:

```
 (IP sumber, port sumber, IP tujuan, port tujuan)
  10.0.0.1   51234        10.0.0.2   443
```

Sisi server tetap (`10.0.0.2:443`). Port klien adalah **port ephemeral** yang dipilih kernel dari `net.ipv4.ip_local_port_range` (bawaannya 32768 sampai 60999). Karena salah satu dari empat nilai itu bisa berbeda, satu port server bisa menampung ratusan ribu koneksi sekaligus. Setiap koneksi punya socket sendiri.

Socket adalah objek kernel untuk satu ujung koneksi. Bagi programmu, socket hanyalah file descriptor, bilangan bulat kecil seperti `3`.

## Membuka koneksi: three-way handshake

```
   klien                                           server
 (CLOSED)                                        (LISTEN)
    │ ── SYN  seq=1000 ──────────────────────────────► │
 SYN-SENT                                     SYN-RECEIVED
    │ ◄──────────────────── SYN+ACK seq=5000 ack=1001 │
 ESTABLISHED                                          │
    │ ── ACK  ack=5001 ──────────────────────────────► │
    │                                           ESTABLISHED
```

1. Klien mengirim `SYN` dengan **initial sequence number** (ISN) acak. ISN dibuat acak supaya penyerang tidak bisa menebaknya lalu menyisipkan paket palsu.
2. Server membalas `SYN+ACK` dengan ISN miliknya. `ack=1001` artinya "byte 1000-mu sudah kuterima". SYN dihitung satu byte walaupun tidak membawa data.
3. Klien mengirim `ACK`. Kedua sisi sekarang `ESTABLISHED`.

Tiap sisi punya nomor urut sendiri, karena satu koneksi TCP sebenarnya dua aliran byte terpisah, satu untuk tiap arah. Handshake memakan satu round trip sebelum data apa pun bergerak. Di link 100 ms, itu 100 ms menunggu, dan TLS menambah minimal satu round trip lagi. Memakai ulang koneksi (HTTP keep-alive, connection pool) menghapus waktu tunggu itu untuk setiap request setelah yang pertama.

## Mengirim data: sequence number, ACK, dan window

```
 klien                                    server
   │ ── seq=1001 len=1000 ──────────────────► │
   │ ── seq=2001 len=1000 ──────────────────► │
   │ ◄─────────────────────────── ack=3001 ── │   "aku punya semuanya sampai 3000"
```

ACK bersifat kumulatif. `ack=3001` mengonfirmasi semua byte sebelum 3001, jadi satu ACK bisa mencakup banyak segmen. Linux juga sedikit menunda ACK dan mengakui tiap dua segmen sekali, sehingga lalu lintas ACK berkurang setengah.

Pengirim boleh punya data belum di-ACK sebanyak ini di jalan:

```
 di jalan ≤ min(rwnd, cwnd)
            │      └── congestion window: tebakan pengirim tentang kapasitas JARINGAN
            └── receive window: kapasitas buffer yang diumumkan PENERIMA (field Window)
```

**Flow control** (`rwnd`) melindungi penerima. Kalau programmu berhenti memanggil `read()`, buffer penerimaan penuh, window yang diumumkan turun ke 0, dan pengirim berhenti. Ini disebut "zero window", dan `tcpdump` menampilkannya sebagai `win 0`.

**Congestion control** (`cwnd`) melindungi jaringan. Koneksi baru mulai dengan `cwnd` = 10 segmen (sekitar 14 KB), lalu kira-kira menggandakannya tiap round trip (slow start) sampai terjadi kehilangan paket. Setelah itu ia mundur dan naik pelan-pelan. Linux memakai CUBIC sebagai bawaan. BBR adalah pilihan umum lainnya. BBR mengukur bandwidth dan RTT alih-alih menganggap setiap paket hilang sebagai kemacetan, sehingga kecepatannya tetap tinggi di link jauh atau link yang sering kehilangan paket.

```bash
sysctl net.ipv4.tcp_congestion_control             # cubic
sysctl net.ipv4.tcp_available_congestion_control   # reno cubic (bbr setelah modprobe tcp_bbr)
```

### Saat paket hilang

TCP tahu ada paket hilang lewat dua cara:

- **Duplicate ACK.** Penerima terus mengirim nomor `ack` yang sama, karena ada satu segmen yang hilang dan ia tidak bisa meng-ACK melewatinya. Setelah tiga duplikat, pengirim langsung mengirim ulang segmen yang hilang. Ini **fast retransmit**. Opsi SACK memberi tahu pengirim blok mana saja yang sudah sampai, jadi yang dikirim ulang hanya yang hilang. Linux modern juga memakai RACK, yang mendeteksi kehilangan berdasarkan waktu ("segmen yang dikirim setelah ini sudah lama di-ACK") alih-alih menghitung duplikat.
- **Retransmission timeout (RTO).** Kalau tidak ada ACK sama sekali, timer berbunyi. RTO dihitung dari RTT yang terukur, minimal 200 ms di Linux, dan 1 detik sebelum RTT diketahui. Setiap timeout menggandakan waktu tunggu.

Aplikasi tidak melihat semua ini. Ia hanya melihat `read()` sedikit lebih lama.

## Menutup koneksi: FIN, TIME-WAIT, dan RST

```
   klien (menutup duluan)                          server
 ESTABLISHED                                    ESTABLISHED
    │ ── FIN  seq=1101 ──────────────────────────────► │
 FIN-WAIT-1                                     CLOSE-WAIT   ◄── read() di server mengembalikan 0
    │ ◄───────────────────────────────── ACK ack=1102 │
 FIN-WAIT-2                                           │      (server masih boleh mengirim)
    │ ◄───────────────────────────────── FIN seq=5301 │      ◄── aplikasi server memanggil close()
 TIME-WAIT                                       LAST-ACK
    │ ── ACK  ack=5302 ──────────────────────────────► │
    │    (menunggu 60 dtk)                        CLOSED
 CLOSED
```

Tiap arah ditutup sendiri-sendiri, jadi penutupan normal butuh empat paket. Sisi yang mengirim `FIN` duluan disebut **active closer**, dan sisi inilah yang berakhir di `TIME-WAIT`.

`TIME-WAIT` berlangsung 60 detik di Linux, angka yang ditanam di kode kernel. Ada dua alasannya. Kalau `ACK` terakhir hilang, lawan bicara mengirim ulang `FIN`-nya, dan sisi yang menutup duluan harus masih mengingat koneksinya untuk meng-ACK-nya lagi. Selain itu, `TIME-WAIT` mencegah paket telat dari koneksi ini nyasar ke koneksi baru yang memakai 4-tuple yang sama.

`RST` memutus koneksi seketika, tanpa urutan penutupan. Kernel mengirimnya ketika:

- SYN datang ke port yang tidak ada yang listen, programmu melihatnya sebagai "Connection refused",
- paket datang untuk koneksi yang tidak dikenal kernel, misalnya setelah reboot,
- program memanggil `close()` padahal masih ada data belum dibaca di buffer penerimaannya,
- aturan firewall berbunyi `reject with tcp reset`.

## State machine

```
                     connect() / kirim SYN
           ┌──────────────────────────────────────► SYN-SENT ──────────────┐
           │                                                               │ terima SYN+ACK
       CLOSED                                                              │ kirim ACK
           │  listen()               terima SYN                            ▼
           └─────────────► LISTEN ─────────────► SYN-RECEIVED ──────► ESTABLISHED
                                   kirim SYN+ACK           terima ACK      │
                                                                           │
            kita menutup duluan:  FIN-WAIT-1 ──► FIN-WAIT-2 ──► TIME-WAIT ──(60 dtk)──► CLOSED
            lawan menutup duluan: CLOSE-WAIT ──(close() kita)──► LAST-ACK ──► CLOSED
```

| State          | Arti                                         | Waspada kalau                               |
| -------------- | -------------------------------------------- | ------------------------------------------- |
| `LISTEN`       | Socket server menunggu SYN.                   | Tidak ada. Tidak ada yang menerima koneksi. |
| `SYN-SENT`     | Klien sudah kirim SYN, belum ada jawaban.     | Bertahan lama. Ada yang membuang SYN-mu.    |
| `SYN-RECEIVED` | Server terima SYN, kirim SYN+ACK, tunggu ACK. | Ada ribuan. Mungkin SYN flood.              |
| `ESTABLISHED`  | Terbuka, data bisa mengalir dua arah.         | Tidak pernah, ini keadaan normal.           |
| `FIN-WAIT-1/2` | Kita sudah menutup, menunggu lawan menutup.   | Banyak `FIN-WAIT-2`. Lawan tidak pernah menutup sisinya. |
| `CLOSE-WAIT`   | Lawan sudah menutup, **program kita belum memanggil `close()`**. | Terus bertambah. Ini bug di kodemu. |
| `LAST-ACK`     | Kita menutup setelah lawan, menunggu ACK-nya. | Jarang jadi masalah.                        |
| `TIME-WAIT`    | Kita menutup duluan, menunggu 60 detik.       | Hanya kalau port ephemeral habis.           |

`ss -tan` menampilkan state ini. `ss` menulis `ESTABLISHED` sebagai `ESTAB` dan `SYN-RECEIVED` sebagai `SYN-RECV`.

## Simulasi

Pilih skenario lalu jalankan langkah demi langkah. Setiap panah adalah satu paket. Kotak menunjukkan state TCP tiap sisi setelah paket itu, dan panel bawah menunjukkan kira-kira apa yang akan dicetak `tcpdump`.

<div class="tcp-sim" data-sim-lang="id"></div>

Yang perlu diperhatikan:

- Di skenario normal, tidak ada kode aplikasi yang berjalan selama handshake. Kedua kernel menyelesaikannya sebelum `accept()` kembali.
- Di skenario paket hilang, server sudah memegang segmen 3 sampai 5 tetapi belum bisa memberikannya ke aplikasi sampai klien mengirim ulang segmen 2. Ini **head-of-line blocking**.
- Skenario ditolak gagal dalam satu round trip. Skenario dibuang butuh sekitar dua menit. Kalau koneksi menggantung alih-alih langsung gagal, cari firewall yang membuang paket.

## TCP berjalan di kernel

Programmu tidak pernah membuat paket TCP. TCP berjalan di dalam kernel sistem operasi. Programmu meminta socket ke kernel, lalu membaca dan menulis byte lewat system call. Kernel yang mengurus sequence number, ACK, timer, retransmisi, dan congestion control.

```python
import socket

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)    # socket(): file descriptor baru
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # bisa restart walau socket lama masih TIME-WAIT
srv.bind(("0.0.0.0", 9000))                                # bind(): klaim port 9000
srv.listen(128)                                            # listen(): kernel kini menjawab SYN sendiri

while True:
    conn, addr = srv.accept()   # accept(): ambil satu handshake yang sudah selesai dari accept queue
    data = conn.recv(4096)      # recv(): salin byte dari buffer penerimaan kernel
    conn.sendall(data)          # send(): salin byte ke buffer pengiriman kernel
    conn.close()                # close(): kernel mengirim FIN
```

| System call       | Yang dikirim ke kabel      | Yang dikerjakan kernel                                     |
| ----------------- | -------------------------- | ---------------------------------------------------------- |
| `socket()`        | tidak ada                  | Membuat socket dan mengembalikan file descriptor.          |
| `bind()`          | tidak ada                  | Memesan alamat dan port, atau gagal dengan `EADDRINUSE`.   |
| `listen(backlog)` | tidak ada                  | Menandai socket `LISTEN` dan menentukan ukuran accept queue. |
| `connect()`       | SYN, lalu ACK              | Menjalankan handshake. Kembali saat `ESTABLISHED`, atau gagal dengan `ECONNREFUSED` atau `ETIMEDOUT`. |
| `accept()`        | tidak ada                  | Mengambil koneksi yang sudah jadi dari accept queue dan memberi descriptor baru. |
| `write()` / `send()` | data, sekarang atau nanti | Menyalin byte ke buffer pengiriman lalu kembali. Hanya blok saat buffer penuh. |
| `read()` / `recv()` | kadang update window    | Menyalin byte dari buffer penerimaan. Mengembalikan 0 setelah lawan mengirim FIN. |
| `shutdown(SHUT_WR)` | FIN                      | Menutup arah kirim saja. Kamu masih bisa membaca.          |
| `close()`         | FIN, atau RST kalau masih ada data belum dibaca | Melepas descriptor. Kernel menyelesaikan penutupan di belakang layar. |

`write()` yang sukses hanya berarti kernel sudah menyalin byte-mu. Itu tidak berarti lawan sudah menerimanya. Kalau lawan crash sedetik kemudian, kamu baru tahu di `write()` atau `read()` berikutnya.

Kamu bisa melihat panggilan ini dengan `strace`:

```bash
strace -e trace=socket,connect,sendto,recvfrom python3 -c '
import socket
s = socket.create_connection(("127.0.0.1", 8765))
s.sendall(b"GET / HTTP/1.0\r\n\r\n")
s.recv(100)'
```

```
socket(AF_INET, SOCK_STREAM|SOCK_CLOEXEC, IPPROTO_TCP) = 3
connect(3, {sa_family=AF_INET, sin_port=htons(8765), sin_addr=inet_addr("127.0.0.1")}, 16) = 0
sendto(3, "GET / HTTP/1.0\r\n\r\n", 18, 0, NULL, 0) = 18
recvfrom(3, "HTTP/1.0 200 OK\r\nServer: SimpleH"..., 100, 0, NULL, NULL) = 100
```

Angka `3` adalah file descriptor. Bagi Linux socket adalah file, jadi `ls -l /proc/<pid>/fd` menampilkannya sebagai `socket:[123456]`, dan `ss -tp` memetakannya kembali ke prosesnya.

### Dua antrean di balik `listen()`

```
             SYN                         ACK terakhir                    accept()
 klien ────────────► SYN queue ─────────────────────► accept queue ─────────────► programmu
                     koneksi setengah jadi            handshake selesai
                     (tcp_max_syn_backlog)            batas: min(backlog, net.core.somaxconn)
```

Kernel tetap menyelesaikan handshake walaupun programmu sedang sibuk. Koneksi yang sudah jadi menunggu di accept queue sampai `accept()` mengambilnya. Kalau accept queue penuh, Linux membuang ACK terakhir dan SYN baru, dan klien tertahan di `SYN-SENT` sambil mencoba ulang. `nstat` menghitung kejadian ini sebagai `TcpExtListenOverflows`. Saat ada SYN flood, SYN cookies (`net.ipv4.tcp_syncookies = 1`) membuat server bisa menjawab tanpa menyimpan apa pun di SYN queue.

### Perjalanan satu paket di Linux

```
          MENGIRIM                                        MENERIMA
 user     write(fd, buf)                                  read(fd, buf)
 ─────────────│─────────────────── syscall ─────────────────────▲─────────────
 kernel       ▼                                                 │
        buffer kirim socket (tcp_wmem)              buffer terima socket (tcp_rmem)
              ▼                                                 ▲
        TCP: potong jadi segmen, seq,               TCP: cek seq, urutkan ulang,
             cwnd, timer retransmisi                     kirim ACK, update window
              ▼                                                 ▲
        IP: pilih rute, tambah header IP            IP: paket ini untukku?
              ▼                                                 ▲
        netfilter: output, postrouting              netfilter: prerouting, input
              ▼                                                 ▲
        qdisc (tc): antre, shaping, delay           GRO: gabungkan segmen kecil
              ▼                                                 ▲
        driver ──► NIC ──► kabel ══════════════════► NIC ──► interrupt, NAPI poll
```

- netfilter adalah tempat aturan nftables berjalan. Aturan `drop` di sana tidak mengirim balasan apa pun, jadi `connect()` menggantung sampai timeout. Lihat tulisan nftables untuk hook-hook-nya.
- qdisc adalah antrean kirim. `tc` mengaturnya, dan `netem` bisa menambahkan delay dan kehilangan paket palsu di sana. Lab di bawah memakainya.
- Offload (TSO, GSO, GRO) membuat kernel cukup memberi kartu jaringan satu potongan 64 KB, lalu kartunya yang memotong jadi segmen 1460 byte. Karena itu `tcpdump` kadang menampilkan "paket" yang jauh lebih besar dari MTU. `ethtool -k eth0` menampilkan daftarnya.

Kernel memperlihatkan isi TCP-nya di beberapa tempat:

```bash
ss -tan                        # semua socket TCP dan state-nya
ss -ti                         # plus detail: rtt, cwnd, retransmisi
nstat -az | grep -i tcp        # counter TCP kernel (retransmisi, drop, reset)
cat /proc/net/tcp              # tabel socket mentah yang dibaca ss (hex)
sysctl -a | grep net.ipv4.tcp  # semua kenop pengaturan
```

### Linux dan sistem operasi lain

Linux, Windows, macOS, dan keluarga BSD masing-masing punya kode TCP sendiri. Semuanya menyediakan Berkeley sockets API yang sama (`socket`, `bind`, `listen`, `accept`, `connect`, `send`, `recv`). Karena itu program Python atau Go yang sama bisa berjalan di semuanya tanpa diubah.

| OS      | Lokasi TCP                            | Cara mengaturnya                  |
| ------- | ------------------------------------- | --------------------------------- |
| Linux   | kernel, `net/ipv4/tcp*.c`             | `sysctl net.ipv4.tcp_*`, `ss`, `tc` |
| Windows | driver kernel `tcpip.sys`, Winsock API | `netsh int tcp`, PowerShell `Get-NetTCPConnection` |
| macOS   | kernel XNU, stack turunan BSD         | `sysctl net.inet.tcp.*`, `netstat` |

Protokol di kabel sama di mana-mana, jadi klien Windows bisa bicara dengan server Linux tanpa perlakuan khusus. Yang berbeda adalah nilai bawaan, seperti window awal, panjang TIME-WAIT, dan timer keepalive. Windows dan macOS juga memakai CUBIC sebagai bawaan.

Ada dua pengecualian yang melewati TCP milik kernel. QUIC (dipakai HTTP/3) berjalan di proses aplikasi itu sendiri di atas UDP, jadi browser bisa merilis versi baru tanpa menunggu update OS. Library kernel-bypass seperti DPDK menjalankan stack TCP di user space untuk laju paket yang sangat tinggi.

## Kapan memakai TCP, dan kapan tidak

| Pakai TCP kalau                              | Pakai UDP kalau                                 |
| -------------------------------------------- | ----------------------------------------------- |
| Setiap byte penting: file, halaman web, API  | Data telat tidak berguna: suara, video call, game |
| Urutan penting: query database, sesi SSH     | Pesan kecil dan berdiri sendiri: DNS, NTP       |
| Kamu ingin OS yang mengurus pengiriman ulang | Kamu perlu mengirim ke banyak host sekaligus (multicast) |
| Koneksi berumur panjang: HTTP/1.1, HTTP/2, gRPC | Kamu membangun keandalan sendiri, seperti QUIC |

Protokol umum dan transport-nya:

| Protokol             | Transport | Alasan                                           |
| -------------------- | --------- | ------------------------------------------------ |
| HTTP/1.1, HTTP/2     | TCP       | Halaman dan respons API harus lengkap.           |
| HTTP/3               | QUIC di atas UDP | Menghindari head-of-line blocking TCP di jaringan seluler yang sering hilang paket, reconnect 0-RTT. |
| SSH, PostgreSQL, MySQL, Redis | TCP | Perintah harus sampai sekali dan berurutan. |
| DNS                  | UDP, TCP untuk jawaban besar dan zone transfer | Satu pertanyaan kecil, satu jawaban kecil. |
| WebRTC, VoIP         | UDP       | Frame yang telat 300 ms lebih buruk daripada frame yang hilang. |
| WireGuard            | UDP       | Membawa TCP di dalamnya. TCP di atas TCP mengirim ulang dua kali dan macet. |

Kesalahan yang sering terjadi adalah membangun game real-time atau siaran video di atas TCP. Saat satu paket hilang, semua paket yang lebih baru menunggu di belakangnya. Dengan UDP kamu bisa melewati yang hilang dan memakai data terbaru.

## Praktik langsung di Linux

Lab ini membuat dua network namespace yang disambung kabel virtual, jadi kamu bisa merusak jaringan tanpa menyentuh jaringan aslimu. Langkah 1 sampai 4 butuh root. Langkah 5 tidak.

### 1. Siapkan dua namespace

```bash
sudo ip netns add client
sudo ip netns add server
sudo ip link add veth-c type veth peer name veth-s     # kabel virtual dengan dua ujung
sudo ip link set veth-c netns client                    # colok satu ujung ke "client"
sudo ip link set veth-s netns server                    # dan ujung lain ke "server"
sudo ip -n client addr add 10.0.0.1/24 dev veth-c
sudo ip -n server addr add 10.0.0.2/24 dev veth-s
sudo ip -n client link set veth-c up
sudo ip -n server link set veth-s up
sudo ip -n server link set lo up

cl() { sudo ip netns exec client "$@"; }   # jalankan perintah di dalam "client"
sv() { sudo ip netns exec server "$@"; }   # jalankan perintah di dalam "server"

cl ping -c 2 10.0.0.2
```

Kedua fungsi ini jalan di bash dan zsh. Tiap namespace punya interface, rute, socket, firewall, dan sysctl TCP sendiri.

### 2. Lihat handshake

```bash
mkdir -p /tmp/tcplab && head -c 20M /dev/urandom > /tmp/tcplab/blob
sv python3 -m http.server 8080 --bind 10.0.0.2 --directory /tmp/tcplab   # terminal 1
sv tcpdump -ni veth-s tcp port 8080                                     # terminal 2
cl curl -s -o /dev/null http://10.0.0.2:8080/                           # terminal 3
```

Tiga baris pertama output `tcpdump` adalah handshake (dipotong):

```
10.0.0.1.41822 > 10.0.0.2.8080: Flags [S],  seq 3542141823, win 64240, options [mss 1460,sackOK,TS ...,nop,wscale 7], length 0
10.0.0.2.8080 > 10.0.0.1.41822: Flags [S.], seq 1803340530, ack 3542141824, win 65160, options [mss 1460,sackOK,TS ...,nop,wscale 7], length 0
10.0.0.1.41822 > 10.0.0.2.8080: Flags [.],  ack 1, win 502, length 0
```

| Flag `tcpdump` | Flag TCP         |
| -------------- | ---------------- |
| `[S]`          | SYN              |
| `[S.]`         | SYN+ACK (`.` artinya ACK) |
| `[.]`          | ACK saja         |
| `[P.]`         | PSH+ACK, membawa data |
| `[F.]`         | FIN+ACK          |
| `[R]` / `[R.]` | RST              |

Setelah handshake, `tcpdump` menampilkan sequence number relatif terhadap ISN (`ack 1`) supaya mudah dibaca. Tambahkan `-S` untuk nilai absolutnya. `win 502` terlihat kecil, tetapi dengan `wscale 7` artinya 502 × 128 = 64256 byte.

### 3. Ditolak, dibuang, dan di-reject

```bash
cl nc -zv 10.0.0.2 9999
# nc: connect to 10.0.0.2 port 9999 (tcp) failed: Connection refused     ← langsung, kernel mengirim RST

sv nft add table inet lab
sv nft add chain inet lab input '{ type filter hook input priority 0; policy accept; }'
sv nft add rule inet lab input tcp dport 9999 drop
sv nft add rule inet lab input tcp dport 9998 reject with tcp reset

cl nc -zv -w 10 10.0.0.2 9999
# menggantung, lalu: nc: connect to 10.0.0.2 port 9999 (tcp) timed out    ← firewall membuang SYN

cl nc -zv 10.0.0.2 9998
# Connection refused                                                       ← firewall memalsukan RST
```

Jalankan `sv tcpdump -ni veth-s -ttt tcp port 9999` saat tes dibuang. `-ttt` mencetak selang waktu antarpaket, dan percobaan ulang SYN datang dengan jarak yang makin panjang: 1, 2, 4, lalu 8 detik. Tanpa `-w`, kernel berhenti setelah `tcp_syn_retries` (6) kali coba, sekitar 127 detik totalnya.

### 4. Tambahkan delay dan kehilangan paket

```bash
sv tc qdisc add dev veth-s root netem delay 50ms loss 2%   # kabel lambat dan bocor dari sisi server
cl ping -c 3 10.0.0.2                                      # RTT sekarang sekitar 50 ms
cl curl -o /dev/null http://10.0.0.2:8080/blob             # catat kecepatannya

sv ss -ti 'sport = :8080'                                  # jalankan selama download
sv nstat -az TcpRetransSegs                                # total segmen yang dikirim ulang
```

`ss -ti` mencetak baris seperti ini untuk tiap koneksi (dipotong, angkamu akan berbeda):

```
cubic wscale:7,7 rto:256 rtt:51.2/1.4 mss:1448 cwnd:14 ssthresh:12 ... retrans:0/37 ...
```

| Field          | Arti                                                     |
| -------------- | -------------------------------------------------------- |
| `cubic`        | Algoritma congestion control socket ini.                 |
| `rtt:51.2/1.4` | Rata-rata round-trip time dan variasinya, dalam ms.      |
| `rto:256`      | Retransmission timeout saat ini, dalam ms.               |
| `cwnd:14`      | Congestion window, dalam segmen.                         |
| `ssthresh:12`  | Batas akhir slow start setelah kehilangan paket terakhir. |
| `retrans:0/37` | Segmen yang sedang dikirim ulang / total.                |

Sekarang bandingkan:

```bash
sv tc qdisc change dev veth-s root netem delay 50ms loss 0%    # tanpa kehilangan: jauh lebih cepat
sv tc qdisc change dev veth-s root netem delay 50ms loss 5%    # lebih banyak hilang: jauh lebih lambat

sudo modprobe tcp_bbr
sv sysctl -w net.ipv4.tcp_congestion_control=bbr               # hanya untuk namespace server
cl curl -o /dev/null http://10.0.0.2:8080/blob                 # biasanya jauh lebih cepat dari cubic di loss 5%
```

CUBIC menganggap setiap paket hilang sebagai antrean penuh dan memotong window-nya. Dengan kehilangan acak tanpa kemacetan sungguhan, pemotongan itu salah. BBR tidak menganggap paket hilang sebagai kemacetan, jadi kehilangan acak jauh lebih sedikit memperlambatnya.

### 5. Penuhi accept queue (tanpa root)

```bash
python3 -c 'import socket, time
s = socket.socket(); s.bind(("127.0.0.1", 7000)); s.listen(2); time.sleep(60)' &   # listen, tapi tidak pernah accept

for i in 1 2 3 4 5 6; do nc 127.0.0.1 7000 </dev/null & done

ss -ltn 'sport = :7000'
ss -tan 'dport = :7000'
nstat -az TcpExtListenOverflows
```

Output di Linux 6.8:

```
State  Recv-Q Send-Q Local Address:Port Peer Address:Port
LISTEN 3      2          127.0.0.1:7000      0.0.0.0:*

State    Recv-Q Send-Q Local Address:Port  Peer Address:Port
ESTAB    0      0          127.0.0.1:60736    127.0.0.1:7000
ESTAB    0      0          127.0.0.1:60746    127.0.0.1:7000
ESTAB    0      0          127.0.0.1:60758    127.0.0.1:7000
SYN-SENT 0      1          127.0.0.1:60770    127.0.0.1:7000
SYN-SENT 0      1          127.0.0.1:60784    127.0.0.1:7000
SYN-SENT 0      1          127.0.0.1:60792    127.0.0.1:7000
```

Di socket `LISTEN`, `Recv-Q` adalah jumlah koneksi yang menunggu di accept queue dan `Send-Q` adalah backlog-nya. Linux mengizinkan backlog + 1 entri, jadi tiga klien sudah `ESTAB` padahal programnya tidak pernah memanggil `accept()`. Tiga sisanya tertahan di `SYN-SENT` karena kernel membuang SYN mereka, dan `ListenOverflows` terus naik.

Untuk melihat `CLOSE-WAIT`, sambungkan ke server yang menutup duluan dan jangan pernah menutup sisimu:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 &
python3 -c 'import socket, time
s = socket.create_connection(("127.0.0.1", 8765))
s.send(b"GET / HTTP/1.0\r\n\r\n"); time.sleep(30)' &
ss -tan '( sport = :8765 or dport = :8765 )'
# CLOSE-WAIT 4460 0   127.0.0.1:53154  127.0.0.1:8765    ← sisi kita: lawan sudah tutup, kita belum
# FIN-WAIT-2 0    0   127.0.0.1:8765   127.0.0.1:53154   ← sisi server: menunggu FIN dari kita
```

### Bersih-bersih

```bash
sudo ip netns del client
sudo ip netns del server        # sekaligus menghapus pasangan veth, aturan tc, dan tabel nft
kill %1 %2 2>/dev/null; pkill -f 'nc 127.0.0.1 7000'
```

## Troubleshooting berdasarkan gejala

| Gejala                                      | Yang terlihat                             | Penyebab dan solusi                             |
| ------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| "Connection refused" seketika               | `RST` di `tcpdump`                        | Tidak ada yang listen di port itu, atau hanya listen di `127.0.0.1`. Cek `ss -ltn`. |
| Connect menggantung, lalu timeout           | Klien di `SYN-SENT`, SYN berulang         | Ada yang membuang paket: firewall, security group, rute salah, host mati. Jalankan `tcpdump` di kedua ujung. |
| Jumlah `CLOSE-WAIT` terus naik              | `ss -tan state close-wait`                | Programmu tidak pernah memanggil `close()`. Tutup socket di `finally` atau `defer`. |
| Ribuan `TIME-WAIT`                          | `ss -tan state time-wait \| wc -l`        | Normal untuk sisi yang menutup duluan. Hanya masalah kalau port ephemeral habis. Pakai ulang koneksi (keep-alive, pool). |
| Klien timeout saat beban tinggi             | `Recv-Q` di `LISTEN` sama dengan `Send-Q`, `ListenOverflows` naik | Program terlalu lambat memanggil accept. Tambah worker, naikkan backlog `listen()` dan `net.core.somaxconn`. |
| Request-response kecil lambat sekitar 40 ms | Jeda di antara segmen kecil               | Algoritma Nagle ditambah delayed ACK. Set `TCP_NODELAY` di socket. |
| Koneksi idle mati setelah beberapa menit    | `RST` atau sunyi setelah idle             | NAT atau load balancer melupakan koneksinya. Aktifkan keepalive dengan waktu idle lebih pendek, atau kirim ping di level aplikasi. |
| Throughput rendah di link jarak jauh        | `cwnd` atau `rwnd` kecil di `ss -ti`      | Window lebih kecil dari bandwidth × RTT. Cek `wscale`, naikkan maksimum `tcp_rmem`/`tcp_wmem`, coba BBR. |

Baris terakhir disebut **bandwidth-delay product**. Untuk mengisi 1 Gbit/s dengan RTT 100 ms, harus ada 12,5 MB data di jalan. Dengan buffer penerimaan maksimum bawaan 6 MB, satu koneksi mentok di sekitar 500 Mbit/s secepat apa pun link-nya.

## Contekan sysctl

Nilai bawaan dari Ubuntu 24.04 dengan kernel 6.8. Baca dengan `sysctl <nama>`, ubah dengan `sysctl -w <nama>=<nilai>`, buat permanen di `/etc/sysctl.d/*.conf`.

| Setting                          | Bawaan             | Mengatur                                        |
| -------------------------------- | ------------------ | ----------------------------------------------- |
| `net.ipv4.tcp_congestion_control` | `cubic`           | Algoritma congestion control.                   |
| `net.ipv4.tcp_syn_retries`       | `6`                | Percobaan ulang SYN sebelum `connect()` gagal (sekitar 127 dtk). |
| `net.ipv4.tcp_synack_retries`    | `5`                | Percobaan ulang SYN+ACK di sisi server.         |
| `net.ipv4.tcp_retries2`          | `15`               | Percobaan ulang data sebelum koneksi yang sudah terbuka diputus (sekitar 15 menit). |
| `net.core.somaxconn`             | `4096`             | Batas maksimum accept queue untuk `listen()` mana pun. |
| `net.ipv4.tcp_max_syn_backlog`   | `1024`             | Batas maksimum SYN queue.                       |
| `net.ipv4.tcp_syncookies`        | `1`                | SYN cookies saat SYN queue meluap.              |
| `net.ipv4.tcp_rmem`              | `4096 131072 6291456` | Buffer terima min, default, max (byte).      |
| `net.ipv4.tcp_wmem`              | `4096 16384 4194304`  | Buffer kirim min, default, max (byte).       |
| `net.ipv4.ip_local_port_range`   | `32768 60999`      | Port ephemeral untuk koneksi keluar.            |
| `net.ipv4.tcp_tw_reuse`          | `2`                | Pakai ulang port `TIME-WAIT` untuk koneksi keluar baru. 2 = hanya loopback. |
| `net.ipv4.tcp_fin_timeout`       | `60`               | Lama socket yatim bertahan di `FIN-WAIT-2`. **Tidak** mengubah `TIME-WAIT`. |
| `net.ipv4.tcp_keepalive_time`    | `7200`             | Detik idle sebelum probe keepalive pertama.     |
| `net.ipv4.tcp_keepalive_intvl`   | `75`               | Detik antarprobe.                                |
| `net.ipv4.tcp_keepalive_probes`  | `9`                | Jumlah probe gagal sebelum koneksi diputus.     |

Jangan menyalin daftar tuning dari blog. Sebagian besar nilai bawaan sudah tepat untuk sebagian besar mesin. Ubah satu nilai saat hasil pengukuran seperti `nstat`, `ss -ti`, atau counter di `/proc/net/netstat` menunjuk ke sana.

## Ringkasan

1. TCP ada di layer 4. IP menemukan mesinnya, port menemukan programnya, dan TCP membuat aliran byte-nya andal.
2. Handshake memakan satu round trip. Pakai ulang koneksi.
3. ACK bersifat kumulatif. Segmen yang hilang dikirim ulang setelah duplicate ACK atau timeout, dan data di belakangnya menunggu.
4. Kecepatan kirim adalah `min(rwnd, cwnd)`. Penerima membatasi `rwnd`, jaringan membatasi `cwnd`.
5. TCP berjalan di kernel. Programmu hanya menyalin byte masuk dan keluar dari buffer socket.
6. Ditolak itu cepat dan berarti tidak ada yang listen. Timeout itu lambat dan berarti ada yang membuang paket.
7. Jumlah `CLOSE-WAIT` yang terus naik berarti programmu tidak memanggil `close()`. `TIME-WAIT` normal, kecuali port ephemeral habis.

</div>

<style>
.tcp-sim{border:1px solid #d0d7de;border-radius:.75rem;padding:1rem;margin:1.5em 0;background:#fff;font-size:.9rem}
.tcp-sim__bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:1rem}
.tcp-sim__bar select,.tcp-sim__bar button{border:1px solid #d0d7de;border-radius:.5rem;padding:.3rem .75rem;background:#f6f8fa;font-size:.85rem;line-height:1.25rem;cursor:pointer;color:#1f2328}
.tcp-sim__bar button:hover:not(:disabled){background:#e9ecef;border-color:#afb8c1}
.tcp-sim__bar button:disabled{opacity:.45;cursor:not-allowed}
.tcp-sim__bar .tcp-sim__count{margin-left:auto;color:#636c76;font-size:.8rem}
.tcp-sim__hosts{display:flex;justify-content:space-between}
.tcp-sim__host{width:8.5rem;text-align:center;border:1px solid #d0d7de;border-radius:.5rem;padding:.35rem .25rem;background:#f6f8fa}
.tcp-sim__host b{display:block;font-size:.7rem;color:#636c76;text-transform:uppercase;letter-spacing:.05em}
.tcp-sim__state{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;font-size:.8rem;color:#0969da}
.tcp-sim__state.is-changed{animation:tcp-sim-flash 1s ease-out}
@keyframes tcp-sim-flash{from{background:#fff8c5}to{background:transparent}}
.tcp-sim__ladder{margin:0 4.25rem;padding:.25rem 0 .5rem;min-height:2.5rem;border-left:2px solid #afb8c1;border-right:2px solid #afb8c1}
.tcp-sim__row{position:relative;height:2.5rem;border-radius:.25rem}
.tcp-sim__row.is-current{background:#ddf4ff}
.tcp-sim__line{position:absolute;top:1.65rem;left:0;right:0;height:2px;background:#1f2328}
.tcp-sim__line::after{content:"";position:absolute;top:-5px;border-top:6px solid transparent;border-bottom:6px solid transparent}
.tcp-sim__row--right .tcp-sim__line::after{right:-1px;border-left:9px solid #1f2328}
.tcp-sim__row--left .tcp-sim__line::after{left:-1px;border-right:9px solid #1f2328}
.tcp-sim__row.is-lost .tcp-sim__line{background:repeating-linear-gradient(90deg,#cf222e 0 6px,transparent 6px 10px)}
.tcp-sim__row--right.is-lost .tcp-sim__line{right:45%}
.tcp-sim__row--left.is-lost .tcp-sim__line{left:45%}
.tcp-sim__row.is-lost .tcp-sim__line::after{content:"\2715";border:0;color:#cf222e;font-weight:700;font-size:.9rem;top:-.7rem}
.tcp-sim__row--right.is-lost .tcp-sim__line::after{right:-.6rem}
.tcp-sim__row--left.is-lost .tcp-sim__line::after{left:-.6rem}
.tcp-sim__label{position:absolute;top:.3rem;left:.5rem;right:.5rem;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tcp-sim__row.is-lost .tcp-sim__label{color:#cf222e}
.tcp-sim__row--event .tcp-sim__label{top:.75rem;color:#636c76;font-style:italic}
.tcp-sim__note{margin-top:.75rem;padding:.6rem .8rem;background:#f6f8fa;border-left:3px solid #0969da;border-radius:.25rem;min-height:3.5rem}
.markdown-body .tcp-sim__dump{margin:.75rem 0 0;font-size:.75rem;line-height:1.5;max-height:12rem;overflow:auto;white-space:pre}
@media (max-width:40rem){.tcp-sim__host{width:6.5rem}.tcp-sim__ladder{margin:0 3.25rem}.tcp-sim__label{font-size:.65rem}}
</style>

<script>
(() => {
  const T = {
    en: {
      client: "Client", server: "Server", scenario: "Scenario",
      back: "Back", next: "Next", play: "Play", pause: "Pause", reset: "Reset",
      step: "Step", lost: "lost", empty: "# tcpdump -ni eth0 tcp (press Next)",
      names: { normal: "Normal: open, send, close", loss: "Packet loss and fast retransmit", refused: "Port closed: refused", dropped: "Firewall drop: timeout" },
    },
    id: {
      client: "Klien", server: "Server", scenario: "Skenario",
      back: "Mundur", next: "Lanjut", play: "Putar", pause: "Jeda", reset: "Ulang",
      step: "Langkah", lost: "hilang", empty: "# tcpdump -ni eth0 tcp (tekan Lanjut)",
      names: { normal: "Normal: buka, kirim, tutup", loss: "Paket hilang dan fast retransmit", refused: "Port tertutup: ditolak", dropped: "Dibuang firewall: timeout" },
    },
  };
  const C = "10.0.0.1.51234", S80 = "10.0.0.2.80", S99 = "10.0.0.2.9999";
  const SCENARIOS = {
    normal: {
      init: ["CLOSED", "LISTEN"],
      intro: {
        en: "The server program called listen() on port 80. The client is about to call connect().",
        id: "Program server sudah memanggil listen() di port 80. Klien akan memanggil connect().",
      },
      steps: [
        { dir: ">", label: "SYN seq=1000", c: "SYN-SENT", s: "SYN-RECEIVED",
          dump: `${C} > ${S80}: Flags [S], seq 1000, win 64240, options [mss 1460,sackOK,TS,wscale 7], length 0`,
          en: "connect() makes the client kernel send a SYN with a random starting sequence number (1000 here) and its options. The server kernel puts a half-open entry in its SYN queue and answers.",
          id: "connect() membuat kernel klien mengirim SYN dengan nomor urut awal acak (di sini 1000) beserta opsinya. Kernel server mencatat entri setengah jadi di SYN queue lalu menjawab." },
        { dir: "<", label: "SYN+ACK seq=5000 ack=1001", c: "ESTABLISHED",
          dump: `${S80} > ${C}: Flags [S.], seq 5000, ack 1001, win 65160, options [mss 1460,sackOK,TS,wscale 7], length 0`,
          en: "The server sends its own SYN (seq 5000) and acknowledges the client's. ack=1001 means \"I have byte 1000, send 1001 next\". A SYN counts as one byte. The client is ESTABLISHED and connect() returns.",
          id: "Server mengirim SYN miliknya (seq 5000) dan meng-ACK SYN klien. ack=1001 artinya \"byte 1000 sudah ada, kirim 1001 berikutnya\". SYN dihitung satu byte. Klien sudah ESTABLISHED dan connect() kembali." },
        { dir: ">", label: "ACK ack=5001", s: "ESTABLISHED",
          dump: `${C} > ${S80}: Flags [.], ack 5001, win 502, length 0`,
          en: "The client acknowledges the server's SYN. The server kernel moves the connection to the accept queue, where accept() picks it up. No application code ran for any of these three packets.",
          id: "Klien meng-ACK SYN server. Kernel server memindahkan koneksi ke accept queue, tempat accept() mengambilnya. Tidak ada kode aplikasi yang berjalan untuk ketiga paket ini." },
        { dir: ">", label: "PSH,ACK seq=1001 len=100",
          dump: `${C} > ${S80}: Flags [P.], seq 1001:1101, ack 5001, win 502, length 100: HTTP: GET / HTTP/1.1`,
          en: "The client calls write() with a 100-byte request. The kernel copies it into the send buffer and sends one segment. seq=1001 is the number of its first byte.",
          id: "Klien memanggil write() dengan request 100 byte. Kernel menyalinnya ke buffer kirim dan mengirim satu segmen. seq=1001 adalah nomor byte pertamanya." },
        { dir: "<", label: "PSH,ACK seq=5001 ack=1101 len=300",
          dump: `${S80} > ${C}: Flags [P.], seq 5001:5301, ack 1101, win 509, length 300: HTTP: HTTP/1.1 200 OK`,
          en: "The server acknowledges the request (1001 + 100 = 1101) and carries the 300-byte response in the same segment. One packet carries both data and an ACK.",
          id: "Server meng-ACK request (1001 + 100 = 1101) sekaligus membawa respons 300 byte di segmen yang sama. Satu paket membawa data dan ACK." },
        { dir: ">", label: "ACK ack=5301",
          dump: `${C} > ${S80}: Flags [.], ack 5301, win 501, length 0`,
          en: "The client confirms the 300 bytes. If this ACK were lost, the server would resend the response when its retransmission timer fires.",
          id: "Klien mengonfirmasi 300 byte itu. Kalau ACK ini hilang, server akan mengirim ulang responsnya saat timer retransmisi berbunyi." },
        { dir: ">", label: "FIN,ACK seq=1101", c: "FIN-WAIT-1", s: "CLOSE-WAIT",
          dump: `${C} > ${S80}: Flags [F.], seq 1101, ack 5301, win 501, length 0`,
          en: "The client calls close(), so its kernel sends FIN: \"I will send no more\". The server enters CLOSE-WAIT, and its next read() returns 0. It stays there until the server program calls close().",
          id: "Klien memanggil close(), jadi kernelnya mengirim FIN: \"aku tidak akan mengirim lagi\". Server masuk CLOSE-WAIT, dan read() berikutnya mengembalikan 0. Ia tetap di sana sampai program server memanggil close()." },
        { dir: "<", label: "ACK ack=1102", c: "FIN-WAIT-2",
          dump: `${S80} > ${C}: Flags [.], ack 1102, win 509, length 0`,
          en: "The server kernel acknowledges the FIN, which also counts as one byte. One direction is closed. The server could still send data.",
          id: "Kernel server meng-ACK FIN tersebut, yang juga dihitung satu byte. Satu arah sudah tertutup. Server masih bisa mengirim data." },
        { dir: "<", label: "FIN,ACK seq=5301", c: "TIME-WAIT", s: "LAST-ACK",
          dump: `${S80} > ${C}: Flags [F.], seq 5301, ack 1102, win 509, length 0`,
          en: "The server program calls close(), and its kernel sends its own FIN. The client enters TIME-WAIT.",
          id: "Program server memanggil close(), dan kernelnya mengirim FIN miliknya. Klien masuk TIME-WAIT." },
        { dir: ">", label: "ACK ack=5302", s: "CLOSED",
          dump: `${C} > ${S80}: Flags [.], ack 5302, win 501, length 0`,
          en: "The client acknowledges the server's FIN. The server forgets the connection.",
          id: "Klien meng-ACK FIN dari server. Server melupakan koneksinya." },
        { dir: "!", label: "60 s later", label_id: "60 detik kemudian", c: "CLOSED",
          en: "Linux keeps TIME-WAIT for 60 seconds, so it can ACK a retransmitted FIN and so late packets cannot leak into a new connection with the same ports. The side that closes first pays this cost.",
          id: "Linux menahan TIME-WAIT selama 60 detik, supaya bisa meng-ACK FIN yang dikirim ulang dan supaya paket telat tidak bocor ke koneksi baru dengan port yang sama. Sisi yang menutup duluan menanggung biaya ini." },
      ],
    },
    loss: {
      init: ["ESTABLISHED", "ESTABLISHED"],
      intro: {
        en: "The connection is already open. The client uploads in 1000-byte segments. Watch what happens when one of them disappears.",
        id: "Koneksi sudah terbuka. Klien mengunggah dalam segmen 1000 byte. Perhatikan apa yang terjadi saat salah satunya hilang.",
      },
      steps: [
        { dir: ">", label: "seq=1001 len=1000",
          dump: `${C} > ${S80}: Flags [.], seq 1001:2001, ack 5001, length 1000`,
          en: "Segment 1 arrives.", id: "Segmen 1 sampai." },
        { dir: "<", label: "ACK ack=2001",
          dump: `${S80} > ${C}: Flags [.], ack 2001, length 0`,
          en: "The server acknowledges every byte up to 2000.", id: "Server meng-ACK semua byte sampai 2000." },
        { dir: ">", label: "seq=2001 len=1000", lost: true,
          dump: `${C} > ${S80}: Flags [.], seq 2001:3001, ack 5001, length 1000   (never arrives)`,
          en: "Segment 2 is dropped on the way, for example by a full router queue. Nobody tells the client.",
          id: "Segmen 2 dibuang di jalan, misalnya oleh antrean router yang penuh. Tidak ada yang memberi tahu klien." },
        { dir: ">", label: "seq=3001 len=1000",
          dump: `${C} > ${S80}: Flags [.], seq 3001:4001, ack 5001, length 1000`,
          en: "Segment 3 arrives, but there is a hole before it. The server keeps it in the out-of-order queue and cannot give it to the application yet.",
          id: "Segmen 3 sampai, tetapi ada lubang sebelumnya. Server menyimpannya di antrean out-of-order dan belum bisa memberikannya ke aplikasi." },
        { dir: "<", label: "ACK 2001 sack 3001-4001",
          dump: `${S80} > ${C}: Flags [.], ack 2001, options [sack 1 {3001:4001}], length 0`,
          en: "Duplicate ACK 1. The server repeats ack=2001. The SACK option adds \"but I do have 3001 to 4000\".",
          id: "Duplicate ACK 1. Server mengulang ack=2001. Opsi SACK menambahkan \"tapi 3001 sampai 4000 sudah ada\"." },
        { dir: ">", label: "seq=4001 len=1000",
          dump: `${C} > ${S80}: Flags [.], seq 4001:5001, ack 5001, length 1000`,
          en: "Segment 4 arrives and joins the out-of-order queue.", id: "Segmen 4 sampai dan masuk antrean out-of-order." },
        { dir: "<", label: "ACK 2001 sack 3001-5001",
          dump: `${S80} > ${C}: Flags [.], ack 2001, options [sack 1 {3001:5001}], length 0`,
          en: "Duplicate ACK 2.", id: "Duplicate ACK 2." },
        { dir: ">", label: "seq=5001 len=1000",
          dump: `${C} > ${S80}: Flags [.], seq 5001:6001, ack 5001, length 1000`,
          en: "Segment 5 arrives.", id: "Segmen 5 sampai." },
        { dir: "<", label: "ACK 2001 sack 3001-6001",
          dump: `${S80} > ${C}: Flags [.], ack 2001, options [sack 1 {3001:6001}], length 0`,
          en: "Duplicate ACK 3. The client now knows exactly which 1000 bytes are missing.",
          id: "Duplicate ACK 3. Klien sekarang tahu persis 1000 byte mana yang hilang." },
        { dir: ">", label: "seq=2001 len=1000 (retransmit)",
          dump: `${C} > ${S80}: Flags [.], seq 2001:3001, ack 5001, length 1000`,
          en: "This is fast retransmit. The client resends only the missing segment, without waiting for the retransmission timer. CUBIC cuts the congestion window to 70%, because loss usually means a queue is full somewhere.",
          id: "Ini fast retransmit. Klien hanya mengirim ulang segmen yang hilang, tanpa menunggu timer retransmisi. CUBIC memotong congestion window menjadi 70%, karena kehilangan paket biasanya berarti ada antrean yang penuh." },
        { dir: "<", label: "ACK ack=6001",
          dump: `${S80} > ${C}: Flags [.], ack 6001, length 0`,
          en: "The hole is filled. One cumulative ACK covers everything, and the kernel hands bytes 2001 to 6000 to the application in order. The application saw a short delay, not the loss.",
          id: "Lubangnya terisi. Satu ACK kumulatif mencakup semuanya, dan kernel menyerahkan byte 2001 sampai 6000 ke aplikasi secara berurutan. Aplikasi hanya melihat jeda singkat, bukan kehilangannya." },
      ],
    },
    refused: {
      init: ["CLOSED", "CLOSED"],
      intro: {
        en: "The server machine is up, but no program listens on port 9999.",
        id: "Mesin server menyala, tetapi tidak ada program yang listen di port 9999.",
      },
      steps: [
        { dir: ">", label: "SYN seq=1000", c: "SYN-SENT",
          dump: `${C} > ${S99}: Flags [S], seq 1000, win 64240, options [mss 1460,sackOK,TS,wscale 7], length 0`,
          en: "The client sends a SYN to port 9999.", id: "Klien mengirim SYN ke port 9999." },
        { dir: "<", label: "RST,ACK ack=1001", c: "CLOSED",
          dump: `${S99} > ${C}: Flags [R.], seq 0, ack 1001, win 0, length 0`,
          en: "No socket listens on that port, so the server kernel answers RST. connect() fails at once with ECONNREFUSED, \"Connection refused\". A refusal proves the host is up and reachable. Only the port is closed.",
          id: "Tidak ada socket yang listen di port itu, jadi kernel server menjawab RST. connect() langsung gagal dengan ECONNREFUSED, \"Connection refused\". Penolakan membuktikan host-nya menyala dan terjangkau. Hanya port-nya yang tertutup." },
      ],
    },
    dropped: {
      init: ["CLOSED", "LISTEN"],
      intro: {
        en: "The server program listens on port 9999, but a firewall in front of it drops those packets (nftables: tcp dport 9999 drop).",
        id: "Program server listen di port 9999, tetapi firewall di depannya membuang paket ke sana (nftables: tcp dport 9999 drop).",
      },
      steps: [
        { dir: ">", label: "t=0s SYN seq=1000", lost: true, c: "SYN-SENT",
          dump: `00:00:00.000 ${C} > ${S99}: Flags [S], seq 1000, length 0`,
          en: "The client sends a SYN. The firewall drops it without a reply.",
          id: "Klien mengirim SYN. Firewall membuangnya tanpa balasan." },
        { dir: ">", label: "t=1s SYN (retry 1)", lost: true,
          dump: `00:00:01.024 ${C} > ${S99}: Flags [S], seq 1000, length 0`,
          en: "No answer after 1 second, the initial timeout. The kernel sends the same SYN again.",
          id: "Tidak ada jawaban setelah 1 detik, timeout awal. Kernel mengirim SYN yang sama lagi." },
        { dir: ">", label: "t=3s SYN (retry 2)", lost: true,
          dump: `00:00:03.072 ${C} > ${S99}: Flags [S], seq 1000, length 0`,
          en: "The wait doubles after every try: 1, 2, 4, 8, 16, 32 seconds.",
          id: "Waktu tunggu berlipat dua setiap kali: 1, 2, 4, 8, 16, 32 detik." },
        { dir: ">", label: "t=7s SYN (retry 3)", lost: true,
          dump: `00:00:07.168 ${C} > ${S99}: Flags [S], seq 1000, length 0`,
          en: "Still nothing. The server program never sees any of these SYNs and stays in LISTEN.",
          id: "Masih tidak ada apa-apa. Program server tidak pernah melihat SYN ini dan tetap di LISTEN." },
        { dir: "!", label: "retries at 15s, 31s, 63s ...", label_id: "coba lagi di 15, 31, 63 dtk ...",
          dump: `00:00:15.360 ...\n00:00:31.744 ...\n00:01:03.488 ...`,
          en: "Three more retries, each also dropped.", id: "Tiga kali coba lagi, semuanya juga dibuang." },
        { dir: "!", label: "t≈127s connect() → ETIMEDOUT", label_id: "t≈127 dtk connect() → ETIMEDOUT", c: "CLOSED",
          en: "With tcp_syn_retries = 6, Linux gives up after about 127 seconds. A timeout means something dropped the packet: a firewall, a dead host, a wrong route. Compare the refused scenario, which fails within milliseconds.",
          id: "Dengan tcp_syn_retries = 6, Linux menyerah setelah sekitar 127 detik. Timeout berarti ada yang membuang paket: firewall, host mati, rute salah. Bandingkan dengan skenario ditolak, yang gagal dalam hitungan milidetik." },
      ],
    },
  };

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  document.querySelectorAll(".tcp-sim").forEach((root) => {
    const lang = root.dataset.simLang === "id" ? "id" : "en";
    const t = T[lang];

    const bar = el("div", "tcp-sim__bar");
    const select = el("select");
    select.setAttribute("aria-label", t.scenario);
    Object.keys(SCENARIOS).forEach((key) => select.appendChild(new Option(t.names[key], key)));
    const back = el("button", null, `◀ ${t.back}`);
    const next = el("button", null, `${t.next} ▶`);
    const play = el("button", null, t.play);
    const reset = el("button", null, t.reset);
    const count = el("span", "tcp-sim__count");
    [back, next, play, reset].forEach((b) => (b.type = "button"));
    bar.append(select, back, next, play, reset, count);

    const hosts = el("div", "tcp-sim__hosts");
    const clientState = el("div", "tcp-sim__state");
    const serverState = el("div", "tcp-sim__state");
    const clientBox = el("div", "tcp-sim__host");
    const serverBox = el("div", "tcp-sim__host");
    clientBox.append(el("b", null, `${t.client} 10.0.0.1`), clientState);
    serverBox.append(el("b", null, `${t.server} 10.0.0.2`), serverState);
    hosts.append(clientBox, serverBox);

    const ladder = el("div", "tcp-sim__ladder");
    const note = el("div", "tcp-sim__note");
    note.setAttribute("aria-live", "polite");
    const dump = el("pre", "tcp-sim__dump");

    root.append(bar, hosts, ladder, note, dump);

    let pos = 0;
    let timer = null;

    const setState = (node, value) => {
      if (node.textContent !== value) {
        node.textContent = value;
        node.classList.remove("is-changed");
        void node.offsetWidth;
        node.classList.add("is-changed");
      }
    };

    const stop = () => {
      clearInterval(timer);
      timer = null;
      play.textContent = t.play;
    };

    const render = () => {
      const sc = SCENARIOS[select.value];
      let c = sc.init[0];
      let s = sc.init[1];
      const lines = [];
      ladder.replaceChildren();
      sc.steps.slice(0, pos).forEach((step, i) => {
        if (step.c) c = step.c;
        if (step.s) s = step.s;
        if (step.dump) lines.push(step.dump);
        const kind = step.dir === ">" ? "right" : step.dir === "<" ? "left" : "event";
        const row = el("div", `tcp-sim__row tcp-sim__row--${kind}`);
        if (step.lost) row.classList.add("is-lost");
        if (i === pos - 1) row.classList.add("is-current");
        const label = (lang === "id" && step.label_id) || step.label;
        row.append(el("span", "tcp-sim__label", step.lost ? `${label} ✕ ${t.lost}` : label));
        if (kind !== "event") row.append(el("span", "tcp-sim__line"));
        ladder.append(row);
      });
      setState(clientState, c);
      setState(serverState, s);
      note.textContent = pos === 0 ? sc.intro[lang] : sc.steps[pos - 1][lang];
      dump.textContent = lines.length ? lines.join("\n") : t.empty;
      dump.scrollTop = dump.scrollHeight;
      count.textContent = `${t.step} ${pos} / ${sc.steps.length}`;
      back.disabled = pos === 0;
      next.disabled = pos === sc.steps.length;
      play.disabled = pos === sc.steps.length;
    };

    const advance = () => {
      if (pos < SCENARIOS[select.value].steps.length) pos += 1;
      if (pos === SCENARIOS[select.value].steps.length) stop();
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
      timer = setInterval(advance, 1600);
    });

    render();
  });
})();
</script>
