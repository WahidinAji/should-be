---
layout: ../../layouts/ContentLayout.astro
title: "Linux Cheat Code: Perintah yang Benar-Benar Dipakai"
title_en: "Linux Cheat Code: The Commands You Actually Use"
description: Perintah Linux dari level dasar, lanjutan, sampai ekstrem. File, teks, proses, izin akses, job, systemd, jaringan, dan SSH tunnel.
description_en: Linux commands at three levels, basic, advanced, and extreme. Files, text, processes, permissions, jobs, systemd, networking, and SSH tunnels.
date: 2026-10-29
tags:
  - linux
  - shell
  - cli
  - sysadmin
  - notes
---

<div data-lang="en" hidden>

## How to read this

A terminal command almost always has the same shape:

```
command [options] [arguments]
   │        │          └── what to act on (files, PIDs, hosts)
   │        └── how to behave (-r, --recursive)
   └── the program
```

You can stack short options, so `-la` is the same as `-l -a`. Long options usually take `=`, as in `--color=auto`. Almost every command accepts `--help`, and `man <command>` opens the full manual. If `man` is too long, `tldr <command>` shows only examples.

The notes come in three levels. Basic is what you type every day. Advanced is what you need once you run a server. Extreme is what you reach for when something is broken and the basic tools show nothing.

## Basic

### Getting around

| Command | What it does |
| --- | --- |
| `pwd` | print the current directory |
| `cd -` | jump back to the previous directory |
| `ls -lah` | long list, hidden files, human sizes |
| `tree -L 2` | directory layout, two levels deep |
| `find . -name "*.go"` | search by name, recursively |
| `fd go` | the same search with shorter syntax, if installed |

Path shortcuts: `.` is the current directory, `..` the parent, `~` your home, `/` the root, and `-` the previous directory.

```bash
cd ~/projects/api && ls -lah      # && runs the second command only if the first succeeds
mkdir -p deploy/staging/config    # -p creates every missing parent
cp -r src/ backup/                # -r copies directories
mv old.txt new.txt                # rename and move are the same command
rm -rf node_modules               # no undo and no trash, read it twice
```

Across most commands, `-r` means recursive, `-f` means do not ask, and `-v` means print what you did.

### Looking inside files

```bash
cat config.yml              # print the whole file, for small files only
less app.log                # scroll: / to search, n for next, q to quit
head -n 20 big.csv          # first 20 lines
tail -n 50 app.log          # last 50 lines
tail -f app.log             # follow new lines live, Ctrl+C to stop
wc -l users.csv             # count lines
```

You will type `tail -f` more than anything else while debugging. `less +F` follows the file the same way, and Ctrl+C lets you scroll back.

### Text: grep, sed, awk

grep picks lines, sed rewrites lines, and awk works with columns. Together they replace most small scripts.

```bash
grep -rn "TODO" src/                 # recursive, with line numbers
grep -i "error" app.log              # ignore case
grep -v "healthcheck" app.log        # invert, print every line that does NOT match
grep -c "500" access.log             # count matching lines

sed 's/localhost/127.0.0.1/g' cfg    # replace every match, print the result
sed -i.bak 's/v1/v2/g' deploy.yml    # edit the file in place, keep deploy.yml.bak
sed -n '10,20p' huge.log             # print only lines 10 to 20

awk '{print $1}' access.log          # first column, split on whitespace
awk -F',' '{print $2}' data.csv      # second column, split on commas
awk '$3 > 100 {print $1, $3}' data   # keep rows where column 3 is over 100
```

### Pipes and redirection

Small commands chain together. That is the real cheat code of Unix.

```bash
grep ERROR app.log | wc -l                 # count error lines
ps aux | grep nginx                        # filter the process list
sort ips.txt | uniq -c | sort -rn | head   # most frequent lines first

command > out.txt      # stdout to a file, overwrite
command >> out.txt     # append
command 2> err.txt     # stderr only
command &> all.txt     # stdout and stderr
command < input.txt    # read stdin from a file
command | tee log.txt  # show the output and save it
```

`sort | uniq -c | sort -rn | head` counts how often anything appears. Learn this one by heart.

### Processes

```bash
ps aux | grep node       # find a process
pgrep -a nginx           # PIDs with their command lines
top                      # live view
htop                     # live view with a better interface

kill 4821                # SIGTERM, lets the process clean up
kill -9 4821             # SIGKILL, last resort
pkill -f "python app.py" # kill by command-line pattern
```

### Permissions

Every file has three groups of permissions: owner, group, and others. Each group can have read (4), write (2), and execute (1). Add the numbers to get one digit per group:

| Digit | Letters | Meaning |
| --- | --- | --- |
| 7 | `rwx` | read, write, execute (4+2+1) |
| 6 | `rw-` | read and write (4+2) |
| 5 | `r-x` | read and execute (4+1) |
| 4 | `r--` | read only |
| 0 | `---` | nothing |

`ls -l` shows the letters. The first character is the type, `-` for a file and `d` for a directory. The next nine are owner, group, and others, three letters each.

```
-rw-------   owner rw-  group ---  others ---   = 600   private keys, files with passwords
-rw-r--r--   owner rw-  group r--  others r--   = 644   normal files, configs, code
-rwxr-xr--   owner rwx  group r-x  others r--   = 754   script your group can run, others only read
-rwxr-xr-x   owner rwx  group r-x  others r-x   = 755   scripts and programs anyone can run
drwx------   owner rwx  group ---  others ---   = 700   private directories like ~/.ssh
drwxr-xr-x   owner rwx  group r-x  others r-x   = 755   normal directories
```

On a directory the letters mean something different. `r` lets you list the names inside, `w` lets you create and delete files inside, and `x` lets you enter it with `cd`. A directory without `x` is closed even if `r` is set.

```bash
chmod 644 config.yml          # numeric mode, set all three groups at once
chmod 600 ~/.ssh/id_ed25519   # private key, owner only
chmod 700 ~/.ssh              # ssh directory, owner only

chmod +x deploy.sh            # symbolic mode: add execute for everyone
chmod u+x deploy.sh           # add execute for the owner only
chmod g-w shared.txt          # remove write from the group
chmod o= secret.txt           # remove everything from others
chmod -R u+rwX,go+rX public/  # capital X adds execute to directories only

chown alice file.txt          # change the owner
chown alice:devs file.txt     # change owner and group
chown :devs file.txt          # change the group only
chown -R www-data:www-data /var/www   # recursive

stat -c '%a %n' file.txt      # print the numeric mode, e.g. "644 file.txt"
```

If SSH refuses your key, check permissions first. `chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_ed25519` fixes most cases.

### Disk and memory

```bash
df -h                       # free space per filesystem
du -sh *                    # size of each item in this directory
du -sh .[!.]* * | sort -h   # include dotfiles, sorted by size
ncdu                        # interactive disk usage browser
free -h                     # RAM and swap
lsblk                       # disks, partitions, and mount points
```

When a disk is full, run `df -h` to find the full filesystem, then run `du -sh *` from its mount point and walk down. The usual causes are logs, Docker images, and package caches.

### Archives and transfers

```bash
tar -czf backup.tar.gz dir/     # create a gzipped archive
tar -xzf backup.tar.gz          # extract
tar -tzf backup.tar.gz          # list contents without extracting

scp file.txt user@host:/tmp/                 # copy over SSH
rsync -avz --progress src/ user@host:/dst/   # copy only what changed, resumable
rsync -avz --delete src/ dst/                # make dst an exact mirror of src
```

Read `czf` as create, zip, file and `xzf` as extract, zip, file. With rsync, a trailing slash on the source means the contents of the directory. Without the slash, rsync copies the directory itself. That slash causes most rsync surprises.

### Shell keys

| Keys | Effect |
| --- | --- |
| `Ctrl+C` | stop the running command |
| `Ctrl+D` | end input, or log out of an empty shell |
| `Ctrl+Z` | pause the running command |
| `Ctrl+R` | search command history |
| `Ctrl+A` / `Ctrl+E` | jump to the start or end of the line |
| `Ctrl+L` | clear the screen |
| `!!` | repeat the last command, e.g. `sudo !!` |
| `!$` | last argument of the previous command |

`Ctrl+R` saves more typing than any alias you will ever write.

## Advanced

### Jobs: foreground, background, detach

A job is a command started from your current shell. These commands only see jobs from that shell.

```bash
./long-task &        # start in the background
jobs -l              # list jobs with their PIDs
# Ctrl+Z             # pause the foreground job
bg %1                # continue job 1 in the background
fg %1                # bring job 1 back to the foreground
wait %1              # block until job 1 finishes
kill %1              # kill job 1 by job number

disown %1            # remove job 1 from the shell, it survives logout
nohup ./task > task.log 2>&1 &   # start immune to logout, output to a file
```

For long work over SSH, use `tmux` instead. `tmux new -s work` starts a session, `Ctrl+b d` detaches, and `tmux attach -t work` reconnects later, even from another machine.

### Scheduling: at, cron, and batch queues

```bash
echo "/opt/deploy.sh" | at 15:00 tomorrow   # run once at a given time
atq                                         # list pending at jobs
atrm 5                                      # delete at job 5
echo "./reindex.sh" | batch                 # run once when system load drops

crontab -e     # edit your recurring jobs
crontab -l     # list them
```

A cron line has five time fields, then the command:

```
┌──────── minute (0-59)
│ ┌────── hour (0-23)
│ │ ┌──── day of month (1-31)
│ │ │ ┌── month (1-12)
│ │ │ │ ┌ day of week (0-7, 0 and 7 are Sunday)
│ │ │ │ │
0 2 * * *      /opt/backup.sh            # every day at 02:00
*/5 * * * *    /opt/check.sh             # every 5 minutes
0 9 * * 1-5    /opt/report.sh            # weekdays at 09:00
0 0 1 * *      /opt/monthly.sh           # first day of every month
```

Cron runs with a minimal `PATH` and no terminal. Use absolute paths and redirect output, for example `/opt/backup.sh >> /var/log/backup.log 2>&1`. Otherwise failures disappear.

On shared clusters, jobs go through a queue instead of running directly. Slurm and PBS are the common ones:

```bash
sbatch job.sh          # Slurm: submit a job script
squeue -u $USER        # Slurm: list your queued and running jobs
scancel 12345          # Slurm: cancel job 12345

qsub job.sh            # PBS: submit
qstat -u $USER         # PBS: list your jobs
```

### Priority: nice and renice

Niceness goes from -20, the highest priority, to 19, the lowest. Normal users can only make a process nicer, which means lower priority. Raising priority needs root.

```bash
nice -n 10 ./backup.sh       # start with lower priority
renice -n 15 -p 1234         # lower the priority of a running process
sudo renice -n -5 -p 1234    # raise it, root only
ionice -c3 ./backup.sh       # low disk priority, only uses idle I/O time
```

### Permissions beyond rwx

New files get their permissions from the umask, which removes bits from a default. Files start at 666 and directories at 777. With the common umask `022`, new files become 644 and new directories become 755.

```bash
umask          # show the current mask, e.g. 0022
umask 077      # new files 600, new directories 700, for this shell
```

There is also a fourth digit in front, for three special bits:

| Bit | Value | On a file | On a directory | Example |
| --- | --- | --- | --- | --- |
| setuid | 4 | runs as the file's owner | no effect | `/usr/bin/passwd` is `4755`, shown as `rwsr-xr-x` |
| setgid | 2 | runs as the file's group | new files inherit the directory's group | shared team folder `2775` |
| sticky | 1 | no effect | only the owner can delete their own files | `/tmp` is `1777`, shown as `rwxrwxrwt` |

```bash
chmod 2775 /srv/team          # team folder, new files keep group "team"
chmod 1777 /srv/dropbox       # anyone can write, nobody deletes other people's files
find / -perm -4000 -type f 2>/dev/null   # list every setuid binary, worth auditing
```

When owner, group, and others are not enough, use ACLs to grant one extra user or group:

```bash
setfacl -m u:alice:rw report.txt     # give alice read and write
setfacl -m g:auditors:r report.txt   # give a group read access
getfacl report.txt                   # show all ACL entries
setfacl -b report.txt                # remove all ACL entries
```

A `+` at the end of the mode in `ls -l`, as in `-rw-r--r--+`, means the file has an ACL.

### systemd and logs

```bash
systemctl status nginx          # is it running, and if not, why
systemctl start nginx           # also: stop, restart
systemctl reload nginx          # re-read config without dropping connections
systemctl enable --now nginx    # start now and on every boot
systemctl list-units --failed   # everything that failed

journalctl -u nginx -f                    # follow one service's logs
journalctl -u nginx --since "1 hour ago"  # recent logs only
journalctl -p err -b                      # errors since the last boot
```

`restart` drops open connections and `reload` usually does not. On production web servers, prefer `reload`.

### Networking

```bash
ip addr                       # interfaces and IP addresses
ip route                      # routing table
ss -tulpn                     # listening ports and the process behind each
ping -c 4 1.1.1.1             # is the host reachable
curl -I https://example.com   # response headers only
curl -sS -o out.json URL      # quiet download to a file
dig +short example.com        # DNS answer only
traceroute example.com        # find where the path breaks
```

`ss -tulpn | grep :8080` is the fastest way to find out which process holds a port.

### SSH keys and config

```bash
ssh-keygen -t ed25519 -C "laptop"       # create a key pair
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@host   # install the public key on a server

eval "$(ssh-agent -s)"                  # start the agent in this shell
ssh-add ~/.ssh/id_ed25519               # load the key, you type the passphrase once

ssh -p 2222 user@host                   # non-standard port
ssh -i ~/.ssh/deploy_key user@host      # use a specific key
scp -P 2222 file.txt user@host:/tmp/    # scp uses capital -P for the port
ssh user@host 'df -h'                   # run one command remotely
ssh user@host 'bash -s' < fix.sh        # run a local script on the remote host
```

Stop typing hosts, ports, and users. Put them in `~/.ssh/config`:

```
Host prod
    HostName 10.0.0.12
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
```

Now `ssh prod`, `scp file prod:/tmp/`, and `rsync -avz src/ prod:/srv/` all use those settings.

## Extreme

### SSH tunnels

A tunnel carries traffic for another port through an SSH connection. There are three kinds.

```bash
# Local forward: localhost:5432 on YOUR machine reaches db.internal:5432 through the bastion
ssh -L 5432:db.internal:5432 user@bastion
psql -h localhost -p 5432        # in another terminal, talks to the internal database

# Remote forward: port 8080 on the SERVER reaches port 3000 on your machine
ssh -R 8080:localhost:3000 user@server

# Dynamic forward: a SOCKS5 proxy on localhost:1080, all traffic exits from the server
ssh -D 1080 user@server
curl --socks5-hostname localhost:1080 https://ifconfig.me   # shows the server's IP

ssh -fN -L 5432:db.internal:5432 user@bastion   # -f goes to background, -N opens no shell
```

Use a local forward to reach something only the server can see. Use a remote forward to show a server something only you can see. Use a dynamic forward to browse as if you were on the server.

By default a remote forward only listens on the server's own loopback. To expose it on the server's public interface, set `GatewayPorts yes` in the server's `sshd_config`.

### Jump hosts

When the target is only reachable from a bastion, jump through it in one command:

```bash
ssh -J user@bastion user@10.0.0.12             # one jump
ssh -J user@bastion1,user@bastion2 user@target # two jumps
```

In `~/.ssh/config`:

```
Host bastion
    HostName bastion.example.com
    User ops

Host db-1
    HostName 10.0.0.12
    User deploy
    ProxyJump bastion
```

`ssh db-1` now goes through the bastion. Tunnels work too: `ssh -L 5432:localhost:5432 db-1`.

### Reusing one SSH connection

Every new `ssh`, `scp`, or `git` command does a full handshake. Connection multiplexing lets them share one open connection, and the second command connects almost instantly:

```
Host *
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlPersist 10m
```

`ssh -O check prod` shows whether a shared connection is open, and `ssh -O exit prod` closes it.

### Seeing what a process is doing

When the logs say nothing, look at the process directly.

```bash
lsof -i :8080              # which process has port 8080 open
lsof -p 1234               # every file and socket PID 1234 has open
lsof +L1                   # deleted files that a process still holds open

strace -p 1234             # live system calls of a running process
strace -f -e trace=network ./app   # only network calls, including child processes
strace -c ./app            # summary: which system calls, how many, how long

cat /proc/1234/status      # memory, threads, and state of PID 1234
ls -l /proc/1234/cwd       # the working directory of PID 1234
```

`lsof +L1` explains a common mystery. `df` says the disk is full but `du` finds nothing. A process still holds a deleted log file open, so the kernel cannot free the space. Restart that process, or truncate the file through `/proc/<pid>/fd/<n>`.

### The handful that solve most incidents

```bash
journalctl -u <service> -n 100 --no-pager   # why did it die
ss -tulpn                                    # who owns the port
df -h && du -sh /var/* | sort -h             # where did the disk go
lsof +L1                                     # space held by deleted files
ps aux --sort=-%mem | head                   # what is eating RAM
dmesg -T | grep -i -E "oom|killed"           # did the kernel kill something
```

## How to actually learn this

1. Stop using the file manager for a week. Do everything in the terminal.
2. When a command works, read `man` for the two flags you just used.
3. Keep a personal `notes.md` of commands that solved a real problem. That file beats any cheat sheet, including this one.
4. Break a throwaway VM on purpose. Fill the disk, kill the wrong process, lock yourself out. Then recover it.

Reading this page will not make you remember it. Typing these commands while something is broken will.

</div>

<div data-lang="id">

## Cara membaca catatan ini

Perintah terminal hampir selalu punya bentuk yang sama:

```
perintah [opsi] [argumen]
    │       │        └── apa yang dikenai (file, PID, host)
    │       └── bagaimana berperilaku (-r, --recursive)
    └── programnya
```

Opsi pendek bisa digabung, jadi `-la` sama dengan `-l -a`. Opsi panjang biasanya pakai `=`, misalnya `--color=auto`. Hampir semua perintah menerima `--help`, dan `man <perintah>` membuka manual lengkapnya. Kalau `man` terlalu panjang, `tldr <perintah>` hanya menampilkan contoh.

Catatan ini dibagi tiga level. Dasar adalah yang kamu ketik setiap hari. Lanjutan adalah yang kamu butuhkan begitu mengurus server. Ekstrem adalah yang kamu pakai saat ada yang rusak dan alat dasar tidak menunjukkan apa-apa.

## Dasar

### Berpindah-pindah

| Perintah | Fungsinya |
| --- | --- |
| `pwd` | tampilkan direktori sekarang |
| `cd -` | kembali ke direktori sebelumnya |
| `ls -lah` | daftar panjang, file tersembunyi, ukuran terbaca |
| `tree -L 2` | struktur direktori, dua level |
| `find . -name "*.go"` | cari berdasarkan nama, rekursif |
| `fd go` | pencarian yang sama dengan sintaks lebih pendek, kalau terpasang |

Pintasan path: `.` direktori sekarang, `..` induknya, `~` home, `/` root, dan `-` direktori sebelumnya.

```bash
cd ~/projects/api && ls -lah      # && menjalankan perintah kedua hanya jika yang pertama sukses
mkdir -p deploy/staging/config    # -p membuat semua folder induk yang belum ada
cp -r src/ backup/                # -r untuk menyalin direktori
mv old.txt new.txt                # rename dan pindah itu perintah yang sama
rm -rf node_modules               # tidak ada undo dan tempat sampah, baca dua kali
```

Di kebanyakan perintah, `-r` berarti rekursif, `-f` berarti jangan tanya, dan `-v` berarti tampilkan apa yang dikerjakan.

### Melihat isi file

```bash
cat config.yml              # tampilkan seluruh file, hanya untuk file kecil
less app.log                # scroll: / untuk cari, n berikutnya, q keluar
head -n 20 big.csv          # 20 baris pertama
tail -n 50 app.log          # 50 baris terakhir
tail -f app.log             # ikuti baris baru secara langsung, Ctrl+C untuk berhenti
wc -l users.csv             # hitung jumlah baris
```

Saat debugging, `tail -f` adalah perintah yang paling sering kamu ketik. `less +F` mengikuti file dengan cara yang sama, dan Ctrl+C membuatmu bisa scroll ke atas.

### Teks: grep, sed, awk

grep memilih baris, sed menulis ulang baris, dan awk bekerja dengan kolom. Bertiga, mereka menggantikan sebagian besar script kecil.

```bash
grep -rn "TODO" src/                 # rekursif, dengan nomor baris
grep -i "error" app.log              # abaikan besar-kecil huruf
grep -v "healthcheck" app.log        # kebalikan, tampilkan baris yang TIDAK cocok
grep -c "500" access.log             # hitung baris yang cocok

sed 's/localhost/127.0.0.1/g' cfg    # ganti semua yang cocok, tampilkan hasilnya
sed -i.bak 's/v1/v2/g' deploy.yml    # edit file langsung, simpan deploy.yml.bak
sed -n '10,20p' huge.log             # tampilkan hanya baris 10 sampai 20

awk '{print $1}' access.log          # kolom pertama, dipisah spasi
awk -F',' '{print $2}' data.csv      # kolom kedua, dipisah koma
awk '$3 > 100 {print $1, $3}' data   # ambil baris yang kolom ketiganya di atas 100
```

### Pipe dan redirect

Perintah-perintah kecil bisa dirangkai. Itulah cheat code Unix yang sebenarnya.

```bash
grep ERROR app.log | wc -l                 # hitung baris error
ps aux | grep nginx                        # saring daftar proses
sort ips.txt | uniq -c | sort -rn | head   # baris yang paling sering muncul di atas

perintah > out.txt      # stdout ke file, timpa
perintah >> out.txt     # tambahkan di akhir
perintah 2> err.txt     # hanya stderr
perintah &> all.txt     # stdout dan stderr
perintah < input.txt    # baca stdin dari file
perintah | tee log.txt  # tampilkan output sekaligus simpan
```

`sort | uniq -c | sort -rn | head` menghitung seberapa sering sesuatu muncul. Hafalkan yang satu ini.

### Proses

```bash
ps aux | grep node       # cari proses
pgrep -a nginx           # PID beserta command line-nya
top                      # tampilan langsung
htop                     # tampilan langsung dengan antarmuka lebih enak

kill 4821                # SIGTERM, memberi proses kesempatan bersih-bersih
kill -9 4821             # SIGKILL, pilihan terakhir
pkill -f "python app.py" # bunuh berdasarkan pola command line
```

### Izin akses

Setiap file punya tiga kelompok izin: pemilik, grup, dan lainnya. Tiap kelompok bisa punya read (4), write (2), dan execute (1). Jumlahkan angkanya untuk mendapat satu digit per kelompok:

| Digit | Huruf | Arti |
| --- | --- | --- |
| 7 | `rwx` | baca, tulis, eksekusi (4+2+1) |
| 6 | `rw-` | baca dan tulis (4+2) |
| 5 | `r-x` | baca dan eksekusi (4+1) |
| 4 | `r--` | baca saja |
| 0 | `---` | tidak ada |

`ls -l` menampilkan hurufnya. Karakter pertama adalah tipe, `-` untuk file dan `d` untuk direktori. Sembilan karakter berikutnya adalah pemilik, grup, dan lainnya, masing-masing tiga huruf.

```
-rw-------   pemilik rw-  grup ---  lainnya ---   = 600   kunci privat, file berisi password
-rw-r--r--   pemilik rw-  grup r--  lainnya r--   = 644   file biasa, config, kode
-rwxr-xr--   pemilik rwx  grup r-x  lainnya r--   = 754   script yang bisa dijalankan grup, lainnya hanya baca
-rwxr-xr-x   pemilik rwx  grup r-x  lainnya r-x   = 755   script dan program yang bisa dijalankan siapa saja
drwx------   pemilik rwx  grup ---  lainnya ---   = 700   direktori privat seperti ~/.ssh
drwxr-xr-x   pemilik rwx  grup r-x  lainnya r-x   = 755   direktori biasa
```

Pada direktori, hurufnya punya arti lain. `r` membolehkan melihat daftar nama di dalamnya, `w` membolehkan membuat dan menghapus file di dalamnya, dan `x` membolehkan masuk dengan `cd`. Direktori tanpa `x` tetap tertutup walaupun `r` aktif.

```bash
chmod 644 config.yml          # mode angka, atur ketiga kelompok sekaligus
chmod 600 ~/.ssh/id_ed25519   # kunci privat, hanya pemilik
chmod 700 ~/.ssh              # direktori ssh, hanya pemilik

chmod +x deploy.sh            # mode simbol: tambah execute untuk semua
chmod u+x deploy.sh           # tambah execute untuk pemilik saja
chmod g-w shared.txt          # cabut write dari grup
chmod o= secret.txt           # cabut semua izin dari lainnya
chmod -R u+rwX,go+rX public/  # X kapital menambah execute hanya ke direktori

chown alice file.txt          # ganti pemilik
chown alice:devs file.txt     # ganti pemilik dan grup
chown :devs file.txt          # ganti grup saja
chown -R www-data:www-data /var/www   # rekursif

stat -c '%a %n' file.txt      # tampilkan mode angka, misalnya "644 file.txt"
```

Kalau SSH menolak kuncimu, cek izin akses dulu. `chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_ed25519` membereskan sebagian besar kasus.

### Disk dan memori

```bash
df -h                       # sisa ruang tiap filesystem
du -sh *                    # ukuran tiap item di direktori ini
du -sh .[!.]* * | sort -h   # termasuk dotfile, diurutkan berdasarkan ukuran
ncdu                        # penjelajah penggunaan disk interaktif
free -h                     # RAM dan swap
lsblk                       # disk, partisi, dan titik mount
```

Saat disk penuh, jalankan `df -h` untuk menemukan filesystem yang penuh, lalu jalankan `du -sh *` dari titik mount-nya dan telusuri ke bawah. Penyebab yang biasa adalah log, image Docker, dan cache paket.

### Arsip dan transfer

```bash
tar -czf backup.tar.gz dir/     # buat arsip gzip
tar -xzf backup.tar.gz          # ekstrak
tar -tzf backup.tar.gz          # lihat isi tanpa mengekstrak

scp file.txt user@host:/tmp/                 # salin lewat SSH
rsync -avz --progress src/ user@host:/dst/   # salin hanya yang berubah, bisa dilanjut
rsync -avz --delete src/ dst/                # jadikan dst salinan persis src
```

Baca `czf` sebagai create, zip, file dan `xzf` sebagai extract, zip, file. Pada rsync, garis miring di akhir sumber berarti isi direktorinya. Tanpa garis miring, rsync menyalin direktorinya sendiri. Garis miring itu penyebab sebagian besar kejutan rsync.

### Tombol shell

| Tombol | Efeknya |
| --- | --- |
| `Ctrl+C` | hentikan perintah yang berjalan |
| `Ctrl+D` | akhiri input, atau logout dari shell kosong |
| `Ctrl+Z` | jeda perintah yang berjalan |
| `Ctrl+R` | cari di riwayat perintah |
| `Ctrl+A` / `Ctrl+E` | lompat ke awal atau akhir baris |
| `Ctrl+L` | bersihkan layar |
| `!!` | ulangi perintah terakhir, misalnya `sudo !!` |
| `!$` | argumen terakhir dari perintah sebelumnya |

`Ctrl+R` menghemat lebih banyak ketikan daripada alias apa pun yang pernah kamu buat.

## Lanjutan

### Job: foreground, background, lepas

Job adalah perintah yang dijalankan dari shell yang sedang kamu pakai. Perintah-perintah ini hanya melihat job dari shell itu.

```bash
./long-task &        # jalankan di background
jobs -l              # daftar job beserta PID-nya
# Ctrl+Z             # jeda job di foreground
bg %1                # lanjutkan job 1 di background
fg %1                # bawa job 1 kembali ke foreground
wait %1              # tunggu sampai job 1 selesai
kill %1              # bunuh job 1 lewat nomor job

disown %1            # lepas job 1 dari shell, tetap hidup setelah logout
nohup ./task > task.log 2>&1 &   # jalankan kebal logout, output ke file
```

Untuk pekerjaan panjang lewat SSH, pakai `tmux`. `tmux new -s work` membuat sesi, `Ctrl+b d` melepasnya, dan `tmux attach -t work` menyambung lagi nanti, bahkan dari mesin lain.

### Penjadwalan: at, cron, dan antrean batch

```bash
echo "/opt/deploy.sh" | at 15:00 tomorrow   # jalankan sekali pada waktu tertentu
atq                                         # daftar job at yang menunggu
atrm 5                                      # hapus job at nomor 5
echo "./reindex.sh" | batch                 # jalankan sekali saat beban sistem turun

crontab -e     # edit job berulang milikmu
crontab -l     # tampilkan daftarnya
```

Satu baris cron berisi lima kolom waktu, lalu perintahnya:

```
┌──────── menit (0-59)
│ ┌────── jam (0-23)
│ │ ┌──── tanggal (1-31)
│ │ │ ┌── bulan (1-12)
│ │ │ │ ┌ hari dalam minggu (0-7, 0 dan 7 adalah Minggu)
│ │ │ │ │
0 2 * * *      /opt/backup.sh            # setiap hari pukul 02:00
*/5 * * * *    /opt/check.sh             # setiap 5 menit
0 9 * * 1-5    /opt/report.sh            # hari kerja pukul 09:00
0 0 1 * *      /opt/monthly.sh           # setiap tanggal 1
```

Cron berjalan dengan `PATH` minimal dan tanpa terminal. Pakai path absolut dan arahkan output ke file, misalnya `/opt/backup.sh >> /var/log/backup.log 2>&1`. Kalau tidak, kegagalannya hilang begitu saja.

Di cluster bersama, job masuk antrean dulu, tidak langsung jalan. Yang umum dipakai adalah Slurm dan PBS:

```bash
sbatch job.sh          # Slurm: kirim script job
squeue -u $USER        # Slurm: daftar job milikmu yang antre dan berjalan
scancel 12345          # Slurm: batalkan job 12345

qsub job.sh            # PBS: kirim job
qstat -u $USER         # PBS: daftar job milikmu
```

### Prioritas: nice dan renice

Nilai niceness dari -20, prioritas tertinggi, sampai 19, prioritas terendah. User biasa hanya bisa menurunkan prioritas proses. Menaikkan prioritas butuh root.

```bash
nice -n 10 ./backup.sh       # jalankan dengan prioritas lebih rendah
renice -n 15 -p 1234         # turunkan prioritas proses yang sedang berjalan
sudo renice -n -5 -p 1234    # naikkan prioritas, hanya root
ionice -c3 ./backup.sh       # prioritas disk rendah, hanya pakai waktu I/O yang menganggur
```

### Izin akses di luar rwx

File baru mendapat izinnya dari umask, yang mengurangi bit dari nilai awal. File mulai dari 666 dan direktori dari 777. Dengan umask umum `022`, file baru menjadi 644 dan direktori baru menjadi 755.

```bash
umask          # tampilkan mask sekarang, misalnya 0022
umask 077      # file baru 600, direktori baru 700, untuk shell ini
```

Ada juga digit keempat di depan, untuk tiga bit khusus:

| Bit | Nilai | Pada file | Pada direktori | Contoh |
| --- | --- | --- | --- | --- |
| setuid | 4 | berjalan sebagai pemilik file | tidak berpengaruh | `/usr/bin/passwd` bernilai `4755`, tampil sebagai `rwsr-xr-x` |
| setgid | 2 | berjalan sebagai grup file | file baru mewarisi grup direktori | folder tim bersama `2775` |
| sticky | 1 | tidak berpengaruh | hanya pemilik yang bisa menghapus file miliknya | `/tmp` bernilai `1777`, tampil sebagai `rwxrwxrwt` |

```bash
chmod 2775 /srv/team          # folder tim, file baru tetap bergrup "team"
chmod 1777 /srv/dropbox       # siapa saja bisa menulis, tidak ada yang bisa hapus file orang lain
find / -perm -4000 -type f 2>/dev/null   # daftar semua binary setuid, layak diaudit
```

Kalau pemilik, grup, dan lainnya tidak cukup, pakai ACL untuk memberi akses ke satu user atau grup tambahan:

```bash
setfacl -m u:alice:rw report.txt     # beri alice baca dan tulis
setfacl -m g:auditors:r report.txt   # beri satu grup akses baca
getfacl report.txt                   # tampilkan semua entri ACL
setfacl -b report.txt                # hapus semua entri ACL
```

Tanda `+` di akhir mode pada `ls -l`, seperti `-rw-r--r--+`, berarti file itu punya ACL.

### systemd dan log

```bash
systemctl status nginx          # jalan atau tidak, dan kalau tidak, kenapa
systemctl start nginx           # juga: stop, restart
systemctl reload nginx          # baca ulang config tanpa memutus koneksi
systemctl enable --now nginx    # jalankan sekarang dan setiap boot
systemctl list-units --failed   # semua yang gagal

journalctl -u nginx -f                    # ikuti log satu service
journalctl -u nginx --since "1 hour ago"  # hanya log terbaru
journalctl -p err -b                      # error sejak boot terakhir
```

`restart` memutus koneksi yang terbuka, `reload` biasanya tidak. Di web server produksi, utamakan `reload`.

### Jaringan

```bash
ip addr                       # interface dan alamat IP
ip route                      # tabel routing
ss -tulpn                     # port yang listen dan proses di baliknya
ping -c 4 1.1.1.1             # apakah host bisa dijangkau
curl -I https://example.com   # hanya header respons
curl -sS -o out.json URL      # unduh diam-diam ke file
dig +short example.com        # jawaban DNS saja
traceroute example.com        # cari di titik mana jalurnya putus
```

`ss -tulpn | grep :8080` adalah cara tercepat mencari proses mana yang memakai sebuah port.

### Kunci dan config SSH

```bash
ssh-keygen -t ed25519 -C "laptop"       # buat pasangan kunci
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@host   # pasang kunci publik di server

eval "$(ssh-agent -s)"                  # jalankan agent di shell ini
ssh-add ~/.ssh/id_ed25519               # muat kunci, passphrase cukup diketik sekali

ssh -p 2222 user@host                   # port non-standar
ssh -i ~/.ssh/deploy_key user@host      # pakai kunci tertentu
scp -P 2222 file.txt user@host:/tmp/    # scp pakai -P kapital untuk port
ssh user@host 'df -h'                   # jalankan satu perintah di remote
ssh user@host 'bash -s' < fix.sh        # jalankan script lokal di host remote
```

Berhenti mengetik host, port, dan user berulang kali. Simpan di `~/.ssh/config`:

```
Host prod
    HostName 10.0.0.12
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
```

Sekarang `ssh prod`, `scp file prod:/tmp/`, dan `rsync -avz src/ prod:/srv/` semuanya memakai pengaturan itu.

## Ekstrem

### Tunnel SSH

Tunnel membawa traffic untuk port lain lewat koneksi SSH. Ada tiga jenis.

```bash
# Forward lokal: localhost:5432 di mesin KAMU menjangkau db.internal:5432 lewat bastion
ssh -L 5432:db.internal:5432 user@bastion
psql -h localhost -p 5432        # di terminal lain, terhubung ke database internal

# Forward remote: port 8080 di SERVER menjangkau port 3000 di mesinmu
ssh -R 8080:localhost:3000 user@server

# Forward dinamis: proxy SOCKS5 di localhost:1080, semua traffic keluar dari server
ssh -D 1080 user@server
curl --socks5-hostname localhost:1080 https://ifconfig.me   # menampilkan IP server

ssh -fN -L 5432:db.internal:5432 user@bastion   # -f pindah ke background, -N tanpa shell
```

Pakai forward lokal untuk menjangkau sesuatu yang hanya bisa dilihat server. Pakai forward remote untuk memperlihatkan ke server sesuatu yang hanya bisa kamu lihat. Pakai forward dinamis untuk browsing seolah-olah kamu berada di server.

Secara default, forward remote hanya listen di loopback milik server. Untuk membukanya di interface publik server, set `GatewayPorts yes` di `sshd_config` server.

### Jump host

Kalau target hanya bisa dijangkau dari bastion, lompati bastion dalam satu perintah:

```bash
ssh -J user@bastion user@10.0.0.12             # satu lompatan
ssh -J user@bastion1,user@bastion2 user@target # dua lompatan
```

Di `~/.ssh/config`:

```
Host bastion
    HostName bastion.example.com
    User ops

Host db-1
    HostName 10.0.0.12
    User deploy
    ProxyJump bastion
```

Sekarang `ssh db-1` otomatis lewat bastion. Tunnel juga bisa: `ssh -L 5432:localhost:5432 db-1`.

### Memakai ulang satu koneksi SSH

Setiap perintah `ssh`, `scp`, atau `git` baru melakukan handshake penuh. Multiplexing membuat semuanya berbagi satu koneksi yang terbuka, sehingga perintah kedua tersambung hampir seketika:

```
Host *
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlPersist 10m
```

`ssh -O check prod` menunjukkan apakah koneksi bersama sedang terbuka, dan `ssh -O exit prod` menutupnya.

### Melihat apa yang dikerjakan sebuah proses

Kalau log tidak bilang apa-apa, lihat prosesnya langsung.

```bash
lsof -i :8080              # proses mana yang membuka port 8080
lsof -p 1234               # semua file dan socket yang dibuka PID 1234
lsof +L1                   # file terhapus yang masih dipegang proses

strace -p 1234             # system call langsung dari proses yang berjalan
strace -f -e trace=network ./app   # hanya panggilan jaringan, termasuk proses anak
strace -c ./app            # ringkasan: system call apa, berapa kali, berapa lama

cat /proc/1234/status      # memori, thread, dan status PID 1234
ls -l /proc/1234/cwd       # direktori kerja PID 1234
```

`lsof +L1` menjelaskan misteri yang sering muncul. `df` bilang disk penuh, tapi `du` tidak menemukan apa-apa. Sebuah proses masih memegang file log yang sudah dihapus, jadi kernel belum bisa membebaskan ruangnya. Restart proses itu, atau kosongkan filenya lewat `/proc/<pid>/fd/<n>`.

### Segelintir perintah yang menyelesaikan sebagian besar insiden

```bash
journalctl -u <service> -n 100 --no-pager   # kenapa dia mati
ss -tulpn                                    # siapa pemilik port-nya
df -h && du -sh /var/* | sort -h             # disk-nya habis ke mana
lsof +L1                                     # ruang yang ditahan file terhapus
ps aux --sort=-%mem | head                   # apa yang memakan RAM
dmesg -T | grep -i -E "oom|killed"           # apakah kernel membunuh sesuatu
```

## Cara benar-benar menguasainya

1. Berhenti pakai file manager selama seminggu. Kerjakan semuanya di terminal.
2. Saat sebuah perintah berhasil, baca `man` untuk dua flag yang barusan kamu pakai.
3. Simpan `notes.md` pribadi berisi perintah yang pernah menyelesaikan masalah nyata. File itu mengalahkan cheat sheet mana pun, termasuk tulisan ini.
4. Rusak VM sekali pakai dengan sengaja. Penuhi disk-nya, bunuh proses yang salah, kunci dirimu sendiri di luar. Lalu pulihkan.

Membaca halaman ini tidak akan membuatmu hafal. Mengetik perintah-perintah ini saat ada yang rusak, itu yang membuatmu hafal.

</div>
