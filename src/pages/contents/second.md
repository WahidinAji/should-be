---
layout: ../../layouts/ContentLayout.astro
title: "Big-O Notation: Notes to Remember / Catatan untuk Diingat (AI Slop)"
description: "A practical, code-first guide to Big-O time and space complexity, in English and Indonesian."
date: 2026-08-28
tags: ["algorithms", "big-o", "go", "notes"]
---

<!--
  Note: adjust the frontmatter fields above to match your Astro content
  collection schema (e.g. src/content/config.ts) before publishing.
-->

<!-- # 🇬🇧 English -->
<div data-lang="en" hidden>

## What it measures
How time or space grows as input size (`n`) grows. Ignores constants and hardware — it's about the *shape* of growth, not exact seconds.

## The common classes (best to worst)

| Notation | Name | Example |
|---|---|---|
| `O(1)` | constant | array index, map lookup |
| `O(log n)` | logarithmic | binary search |
| `O(n)` | linear | single loop |
| `O(n log n)` | linearithmic | sorting |
| `O(n²)` | quadratic | nested loop, same collection |
| `O(2ⁿ)` | exponential | naive recursion, no caching |
| `O(n!)` | factorial | brute-force permutations |

## Letters are just labels for "size of the thing"

`n`, `k`, `m` all mean the same kind of thing: "how big is whatever I'm iterating/processing here." Don't be intimidated by unfamiliar letters — ask **what does this variable count?**

- `O(k log k)` = sorting one item of size `k` (e.g. sorting the characters of one string)
- `O(n · k log k)` = doing that sort inside a loop over `n` items

## Notation → code shape (explicit, side by side)

### `O(1)` — constant
```go
func first(items []int) int {
    return items[0]   // no loop, no dependence on len(items)
}
```

### `O(log n)` — range halves each step
```go
for lo < hi {
    mid := (lo + hi) / 2
    if target < arr[mid] {
        hi = mid
    } else {
        lo = mid + 1
    }
}
```
Cue: search space **shrinks by half** every iteration — not a full pass.

### `O(n)` — one loop over n items
```go
for _, x := range items {
    sum += x
}
```
Cue: **one** loop, walks the whole collection once.

### `O(n log n)` — a loop/sort where the "log" part is on the whole n
```go
sort.Slice(items, func(i, j int) bool { return items[i] < items[j] })
```
Cue: sorting the **whole n-sized collection** once, or a loop over `n` where each step does a `log n` operation (e.g. binary search inside a loop).

### `O(n²)` — two nested loops, SAME collection
```go
for i := range items {
    for j := range items {
        // compare items[i], items[j]
    }
}
```
Cue: both loops depend on the **same** `n`.

### `O(n·m)` — two nested loops, TWO DIFFERENT collections
```go
for i := range listA {      // size n
    for j := range listB {  // size m
        // compare listA[i], listB[j]
    }
}
```
Cue: two **independent** sizes — `n` and `m` don't have to be related.

### `O(k log k)` — sort happening INSIDE one item, not across the collection
```go
func sortString(s string) string {   // s has length k
    b := []byte(s)
    sort.Slice(b, func(i, j int) bool { return b[i] < b[j] })
    return string(b)
}
```
Cue: the sort is on a **substructure** (one word), not the whole outer collection.

### `O(n · k log k)` — the above, called once per item in an outer loop
```go
for _, s := range strs {        // n strings
    key := sortString(s)        // O(k log k) each — s has length k
    groups[key] = append(groups[key], s)
}
```
Cue: outer loop size `n`, multiplied by inner cost `k log k`.

### `O(2ⁿ)` — recursion branching into 2+ calls per level, no caching
```go
func fib(n int) int {
    if n <= 1 {
        return n
    }
    return fib(n-1) + fib(n-2)   // 2 recursive calls each time
}
```
Cue: **no loop at all** — growth comes from branching recursive calls.

## n² vs n·m — the easy-to-confuse pair

Both *look* like two nested loops. The difference is what's being looped over.

```go
// O(n²) — both loops walk the SAME collection
for i := range items {
    for j := range items { ... }
}

// O(n·m) — loops walk TWO DIFFERENT (independent) collections
for i := range listA {   // size n
    for j := range listB { ... }  // size m
}
```

- Same collection/index range on both loops → **one letter, squared** (`n²`)
- Different, independent things being iterated → **two letters, multiplied** (`n·m`)

Why it matters: `n=1000, m=5` → `n·m = 5,000` (fast), but mistaking it for `n²` = 1,000,000 wildly overestimates the cost. The letters preserve real information about the inputs — don't collapse them just because the code *looks* symmetric.

## How to derive complexity from code

For every loop or recursive call, ask:
1. **What am I iterating over, and how big is it?** → that becomes a variable
2. **Is it nested inside another loop?** → multiply the costs
3. **Does it happen sequentially (not nested)?** → add the costs (usually just keep the biggest term)
4. **Does it call something that isn't O(1)?** (a sort, another loop, a recursive call) → multiply that cost in

```go
for _, s := range strs {        // O(n) — n strings
    key := sortString(s)        // O(k log k) — sort inside the loop
    groups[key] = append(...)   // O(k) amortized
}
// total: O(n · k log k)
```

## Big-O → what to reach for when coding

| Want this | Reach for |
|---|---|
| `O(1)` lookup | map / hash table |
| `O(log n)` | binary search, balanced trees, halve the problem |
| `O(n)` | single pass, or a map to avoid nested loops |
| `O(n log n)` | sorting, divide-and-conquer |
| avoid `O(n²)` | replace nested loop with a map — classic trade **space for time** |

Classic pattern — turning `O(n²)` into `O(n)`:
```go
// O(n²): nested loop checking every pair
for i := 0; i < len(nums); i++ {
    for j := i + 1; j < len(nums); j++ {
        if nums[i] == nums[j] { return true }
    }
}

// O(n): map trades space for time
seen := make(map[int]bool)
for _, x := range nums {
    if seen[x] { return true }
    seen[x] = true
}
```

## Time complexity vs space complexity (explicit)

Every algorithm has **two** costs. Big-O can describe either one — always check which one is being talked about.

### Time complexity — how many operations as n grows
Counts **steps/operations**, not wall-clock seconds.

```go
func sum(nums []int) int {
    total := 0
    for _, x := range nums {   // n steps
        total += x
    }
    return total
}
// Time: O(n) — one operation per element
// Space: O(1) — only `total` is extra, doesn't grow with n
```

### Space complexity — how much EXTRA memory as n grows
Counts memory **beyond the input itself** — auxiliary arrays, maps, recursion call stack, etc. The input array itself usually isn't counted (unless you're told to count it).

```go
func double(nums []int) []int {
    result := make([]int, len(nums))   // new array, size n
    for i, x := range nums {
        result[i] = x * 2
    }
    return result
}
// Time: O(n) — one operation per element
// Space: O(n) — `result` is a brand new array that grows with n
```

### Same time, different space (the classic trade-off)

```go
// O(n) time, O(n) SPACE — extra map grows with n
func hasDuplicate(nums []int) bool {
    seen := make(map[int]bool)
    for _, x := range nums {
        if seen[x] { return true }
        seen[x] = true
    }
    return false
}

// O(n log n) time, O(1) SPACE — sort in place, no extra structure
func hasDuplicate(nums []int) bool {
    sort.Ints(nums)
    for i := 1; i < len(nums); i++ {
        if nums[i] == nums[i-1] { return true }
    }
    return false
}
```
Same problem, two valid answers — one is faster (better time), the other uses less memory (better space). Neither is "wrong"; picking one is a **trade-off**, not a correctness issue.

### Recursion has HIDDEN space cost: the call stack

```go
func fib(n int) int {
    if n <= 1 { return n }
    return fib(n-1) + fib(n-2)
}
// Time: O(2ⁿ) — branching calls
// Space: O(n) — NOT O(2ⁿ)! Only the current call chain (depth n)
//               sits on the stack at once, not every branch simultaneously.
```
Cue: for recursion, **time** often depends on total number of calls (branching), while **space** often depends only on **how deep** the recursion goes (the longest chain of calls waiting on the stack at once).

### Quick way to spot space complexity in code
Ask: **"what extra thing did I create that grows if the input grows?"**
- New slice/array/map sized off `n` → `O(n)` space
- Just a few variables (counters, sums, booleans) → `O(1)` space
- Recursive function → space = **max depth** of the call stack, not total calls

## Which physical resource each one stresses (CPU vs RAM)

Big-O time and space aren't just abstract math — they map directly to a real resource on the machine running your code.

| Complexity type | Physical resource | What "grows" |
|---|---|---|
| **Time complexity** | **CPU** | Number of instructions the CPU has to execute. More operations = more CPU cycles = longer wall-clock time. |
| **Space complexity** | **RAM** | Amount of memory allocated beyond the input. More extra data structures = more bytes held in memory at once. |

### Time complexity = CPU cost
```go
func sum(nums []int) int {
    total := 0
    for _, x := range nums {   // CPU does this add-and-store, n times
        total += x
    }
    return total
}
```
Every loop iteration is literally more instructions the **CPU** has to churn through. `O(n²)` vs `O(n)` means the CPU does dramatically more work as `n` grows — that's why big-O(n²) algorithms feel "slow"/high CPU usage on large input.

### Space complexity = RAM cost
```go
func double(nums []int) []int {
    result := make([]int, len(nums))   // this allocation eats RAM, size n
    for i, x := range nums {
        result[i] = x * 2
    }
    return result
}
```
`result` is a chunk of memory sitting in **RAM** whose size scales with `n`. If `n` is huge, this is what causes out-of-memory errors — not a slow CPU, but not enough RAM to hold the extra structure.

### Why the distinction matters for real debugging
- App is **slow but memory usage looks fine** → likely a **time complexity** problem (too many CPU operations, e.g. an accidental `O(n²)` nested loop) → profile CPU / count operations
- App **crashes with out-of-memory, or RAM usage balloons** → likely a **space complexity** problem (too much extra data allocated, e.g. building a giant map or duplicating arrays) → profile memory allocations

### Recursion stresses BOTH, differently
```go
func fib(n int) int {
    if n <= 1 { return n }
    return fib(n-1) + fib(n-2)
}
```
- **CPU**: `O(2ⁿ)` — the CPU executes an exponential number of calls
- **RAM**: `O(n)` — only the current call chain sits on the stack (uses stack memory) at any given moment, not all branches at once

So it's very possible for something to be **CPU-heavy but RAM-light** (like naive fib) or **RAM-heavy but CPU-light** (like caching every result you've ever computed to skip recalculating).

## Other reminders

- Big-O usually means **worst case** unless stated otherwise (average/best case can differ — e.g. quicksort avg `O(n log n)`, worst `O(n²)`)
- Sequential operations **add** (`O(n) + O(n) = O(n)`); nested operations **multiply**
- Every algorithm has both **time and space** complexity — count extra memory too (maps, auxiliary arrays, recursion stack)
- Name loop variables to match what they count (`n`, `k`, `m`) — it documents complexity as you write

## How to build the skill

1. Learn the small toolkit above (~6 shapes) — don't memorize a giant catalog
2. For every loop/recursion you write, ask "what am I iterating, how big, nested or sequential?"
3. Practice deriving Big-O on code you already understand before checking answers
4. When you see an unfamiliar letter, ask what it's counting — it's almost always answerable from context
5. Good resource: *Grokking Algorithms* by Aditya Bhargava (visual, beginner-friendly)

---
</div>

<!-- # 🇮🇩 Bahasa Indonesia -->

<div data-lang="id">
## Apa yang diukur
Bagaimana waktu atau memori bertambah seiring bertambahnya ukuran input (`n`). Notasi ini mengabaikan konstanta dan spesifikasi hardware — yang dilihat adalah **bentuk pertumbuhannya**, bukan detik pastinya.

## Kelas-kelas umum (dari terbaik ke terburuk)

| Notasi | Nama | Contoh |
|---|---|---|
| `O(1)` | konstan | akses index array, lookup map |
| `O(log n)` | logaritmik | binary search |
| `O(n)` | linear | satu loop |
| `O(n log n)` | linearithmic | sorting |
| `O(n²)` | kuadratik | nested loop, koleksi yang sama |
| `O(2ⁿ)` | eksponensial | rekursi naif, tanpa caching |
| `O(n!)` | faktorial | brute-force permutasi |

## Huruf hanyalah label untuk "ukuran sesuatu"

`n`, `k`, `m` semuanya bermakna sama: "seberapa besar hal yang sedang saya iterasi/proses di sini." Jangan minder dengan huruf yang belum familiar — tanyakan **variabel ini menghitung apa?**

- `O(k log k)` = mengurutkan satu item berukuran `k` (misalnya mengurutkan karakter dalam satu string)
- `O(n · k log k)` = melakukan sort itu di dalam loop sebanyak `n` item

## Notasi → bentuk kode (eksplisit, berdampingan)

### `O(1)` — konstan
```go
func first(items []int) int {
    return items[0]   // tidak ada loop, tidak bergantung pada len(items)
}
```

### `O(log n)` — rentang mengecil separuh setiap langkah
```go
for lo < hi {
    mid := (lo + hi) / 2
    if target < arr[mid] {
        hi = mid
    } else {
        lo = mid + 1
    }
}
```
Ciri: ruang pencarian **mengecil separuh** setiap iterasi — bukan pass penuh.

### `O(n)` — satu loop atas n item
```go
for _, x := range items {
    sum += x
}
```
Ciri: **satu** loop, melewati seluruh koleksi sekali.

### `O(n log n)` — loop/sort di mana bagian "log" terjadi pada seluruh n
```go
sort.Slice(items, func(i, j int) bool { return items[i] < items[j] })
```
Ciri: mengurutkan **seluruh koleksi berukuran n** sekali, atau loop atas `n` di mana tiap langkahnya melakukan operasi `log n` (misalnya binary search di dalam loop).

### `O(n²)` — dua nested loop, koleksi SAMA
```go
for i := range items {
    for j := range items {
        // bandingkan items[i], items[j]
    }
}
```
Ciri: kedua loop bergantung pada `n` yang **sama**.

### `O(n·m)` — dua nested loop, DUA KOLEKSI BERBEDA
```go
for i := range listA {      // ukuran n
    for j := range listB {  // ukuran m
        // bandingkan listA[i], listB[j]
    }
}
```
Ciri: dua ukuran yang **independen** — `n` dan `m` tidak harus berhubungan.

### `O(k log k)` — sort terjadi DI DALAM satu item, bukan lintas koleksi
```go
func sortString(s string) string {   // s memiliki panjang k
    b := []byte(s)
    sort.Slice(b, func(i, j int) bool { return b[i] < b[j] })
    return string(b)
}
```
Ciri: sort dilakukan pada **substruktur** (satu kata), bukan seluruh koleksi luar.

### `O(n · k log k)` — hal di atas, dipanggil sekali per item dalam loop luar
```go
for _, s := range strs {        // n string
    key := sortString(s)        // O(k log k) tiap panggilan — s panjangnya k
    groups[key] = append(groups[key], s)
}
```
Ciri: ukuran loop luar `n`, dikalikan biaya bagian dalam `k log k`.

### `O(2ⁿ)` — rekursi bercabang jadi 2+ panggilan tiap level, tanpa caching
```go
func fib(n int) int {
    if n <= 1 {
        return n
    }
    return fib(n-1) + fib(n-2)   // 2 panggilan rekursif tiap kali
}
```
Ciri: **tidak ada loop sama sekali** — pertumbuhannya berasal dari percabangan panggilan rekursif.

## n² vs n·m — pasangan yang mudah tertukar

Keduanya *terlihat* seperti dua nested loop. Bedanya ada pada apa yang di-loop.

```go
// O(n²) — kedua loop melewati koleksi YANG SAMA
for i := range items {
    for j := range items { ... }
}

// O(n·m) — loop melewati DUA koleksi (independen) yang BERBEDA
for i := range listA {   // ukuran n
    for j := range listB { ... }  // ukuran m
}
```

- Koleksi/range index sama di kedua loop → **satu huruf, dikuadratkan** (`n²`)
- Hal berbeda dan independen yang di-iterasi → **dua huruf, dikalikan** (`n·m`)

Kenapa penting: `n=1000, m=5` → `n·m = 5.000` (cepat), tapi jika salah dianggap `n²` = 1.000.000, itu sangat berlebihan menaksir biayanya. Huruf-huruf ini menyimpan informasi nyata tentang input — jangan disatukan hanya karena kodenya *terlihat* simetris.

## Cara menurunkan kompleksitas dari kode

Untuk setiap loop atau pemanggilan rekursif, tanyakan:
1. **Apa yang saya iterasi, dan seberapa besar?** → itu jadi sebuah variabel
2. **Apakah ini bersarang di dalam loop lain?** → kalikan biayanya
3. **Apakah terjadi berurutan (tidak bersarang)?** → jumlahkan biayanya (biasanya cukup ambil suku terbesar)
4. **Apakah memanggil sesuatu yang bukan O(1)?** (sort, loop lain, panggilan rekursif) → kalikan biaya itu

```go
for _, s := range strs {        // O(n) — n string
    key := sortString(s)        // O(k log k) — sort di dalam loop
    groups[key] = append(...)   // O(k) amortized
}
// total: O(n · k log k)
```

## Big-O → apa yang dipakai saat coding

| Ingin ini | Pakai ini |
|---|---|
| lookup `O(1)` | map / hash table |
| `O(log n)` | binary search, balanced tree, membagi masalah jadi separuh |
| `O(n)` | satu pass, atau map untuk menghindari nested loop |
| `O(n log n)` | sorting, divide-and-conquer |
| menghindari `O(n²)` | ganti nested loop dengan map — trik klasik menukar **memori demi kecepatan** |

Pola klasik — mengubah `O(n²)` jadi `O(n)`:
```go
// O(n²): nested loop mengecek setiap pasangan
for i := 0; i < len(nums); i++ {
    for j := i + 1; j < len(nums); j++ {
        if nums[i] == nums[j] { return true }
    }
}

// O(n): map menukar memori demi kecepatan
seen := make(map[int]bool)
for _, x := range nums {
    if seen[x] { return true }
    seen[x] = true
}
```

## Time complexity vs space complexity (eksplisit)

Setiap algoritma punya **dua** biaya. Big-O bisa menjelaskan salah satunya — selalu periksa yang mana yang sedang dibahas.

### Time complexity — berapa banyak operasi seiring n bertambah
Menghitung **langkah/operasi**, bukan detik di jam dinding.

```go
func sum(nums []int) int {
    total := 0
    for _, x := range nums {   // n langkah
        total += x
    }
    return total
}
// Time: O(n) — satu operasi per elemen
// Space: O(1) — hanya `total` yang ekstra, tidak bertambah seiring n
```

### Space complexity — berapa banyak memori EKSTRA seiring n bertambah
Menghitung memori **di luar input itu sendiri** — array bantu, map, call stack rekursi, dll. Array input sendiri biasanya tidak dihitung (kecuali diminta untuk dihitung).

```go
func double(nums []int) []int {
    result := make([]int, len(nums))   // array baru, ukuran n
    for i, x := range nums {
        result[i] = x * 2
    }
    return result
}
// Time: O(n) — satu operasi per elemen
// Space: O(n) — `result` adalah array baru yang bertambah seiring n
```

### Waktu sama, memori berbeda (trade-off klasik)

```go
// O(n) time, O(n) SPACE — map ekstra bertambah seiring n
func hasDuplicate(nums []int) bool {
    seen := make(map[int]bool)
    for _, x := range nums {
        if seen[x] { return true }
        seen[x] = true
    }
    return false
}

// O(n log n) time, O(1) SPACE — sort in place, tanpa struktur ekstra
func hasDuplicate(nums []int) bool {
    sort.Ints(nums)
    for i := 1; i < len(nums); i++ {
        if nums[i] == nums[i-1] { return true }
    }
    return false
}
```
Masalah sama, dua jawaban valid — satu lebih cepat (time lebih baik), satu lagi memakai memori lebih sedikit (space lebih baik). Tidak ada yang "salah"; memilih salah satu adalah **trade-off**, bukan soal benar-salah.

### Rekursi punya biaya memori TERSEMBUNYI: call stack

```go
func fib(n int) int {
    if n <= 1 { return n }
    return fib(n-1) + fib(n-2)
}
// Time: O(2ⁿ) — panggilan bercabang
// Space: O(n) — BUKAN O(2ⁿ)! Hanya rantai panggilan saat ini (kedalaman n)
//               yang berada di stack sekaligus, bukan semua cabang bersamaan.
```
Ciri: untuk rekursi, **time** biasanya bergantung pada total jumlah panggilan (percabangan), sedangkan **space** biasanya hanya bergantung pada **seberapa dalam** rekursinya (rantai panggilan terpanjang yang menunggu di stack sekaligus).

### Cara cepat mengenali space complexity dalam kode
Tanyakan: **"struktur ekstra apa yang saya buat yang ikut membesar jika input membesar?"**
- Slice/array/map baru berukuran `n` → space `O(n)`
- Hanya beberapa variabel (counter, sum, boolean) → space `O(1)`
- Fungsi rekursif → space = **kedalaman maksimum** call stack, bukan total panggilan

## Resource fisik mana yang ditekan (CPU vs RAM)

Time dan space complexity bukan cuma matematika abstrak — keduanya berhubungan langsung dengan resource nyata di mesin yang menjalankan kode.

| Jenis kompleksitas | Resource fisik | Apa yang "membesar" |
|---|---|---|
| **Time complexity** | **CPU** | Jumlah instruksi yang harus dieksekusi CPU. Lebih banyak operasi = lebih banyak siklus CPU = waktu eksekusi lebih lama. |
| **Space complexity** | **RAM** | Jumlah memori yang dialokasikan di luar input. Lebih banyak struktur data ekstra = lebih banyak byte yang disimpan di memori sekaligus. |

### Time complexity = biaya CPU
```go
func sum(nums []int) int {
    total := 0
    for _, x := range nums {   // CPU melakukan tambah-dan-simpan ini, n kali
        total += x
    }
    return total
}
```
Setiap iterasi loop secara harfiah berarti lebih banyak instruksi yang harus diproses **CPU**. `O(n²)` dibanding `O(n)` berarti CPU bekerja jauh lebih banyak seiring `n` membesar — itulah sebabnya algoritma `O(n²)` terasa "lambat"/penggunaan CPU tinggi pada input besar.

### Space complexity = biaya RAM
```go
func double(nums []int) []int {
    result := make([]int, len(nums))   // alokasi ini memakan RAM, ukuran n
    for i, x := range nums {
        result[i] = x * 2
    }
    return result
}
```
`result` adalah bagian memori di **RAM** yang ukurannya mengikuti `n`. Jika `n` sangat besar, inilah yang menyebabkan error out-of-memory — bukan CPU yang lambat, tapi RAM yang tidak cukup untuk menampung struktur ekstra tersebut.

### Kenapa perbedaan ini penting untuk debugging nyata
- Aplikasi **lambat tapi penggunaan memori terlihat normal** → kemungkinan masalah **time complexity** (terlalu banyak operasi CPU, misalnya nested loop `O(n²)` yang tidak sengaja) → profiling CPU / hitung operasi
- Aplikasi **crash karena out-of-memory, atau penggunaan RAM membengkak** → kemungkinan masalah **space complexity** (terlalu banyak data ekstra yang dialokasikan, misalnya membuat map raksasa atau menduplikasi array) → profiling alokasi memori

### Rekursi menekan KEDUANYA, dengan cara berbeda
```go
func fib(n int) int {
    if n <= 1 { return n }
    return fib(n-1) + fib(n-2)
}
```
- **CPU**: `O(2ⁿ)` — CPU mengeksekusi jumlah panggilan yang eksponensial
- **RAM**: `O(n)` — hanya rantai panggilan saat ini yang berada di stack (memakai memori stack) di satu waktu, bukan semua cabang sekaligus

Jadi sangat mungkin sesuatu itu **berat di CPU tapi ringan di RAM** (seperti fib naif) atau **berat di RAM tapi ringan di CPU** (seperti caching setiap hasil yang pernah dihitung untuk menghindari perhitungan ulang).

## Pengingat lainnya

- Big-O biasanya berarti **worst case** kecuali dinyatakan lain (average/best case bisa berbeda — misalnya quicksort rata-rata `O(n log n)`, worst case `O(n²)`)
- Operasi berurutan **dijumlahkan** (`O(n) + O(n) = O(n)`); operasi bersarang **dikalikan**
- Setiap algoritma punya **time dan space** complexity — hitung juga memori ekstra (map, array bantu, stack rekursi)
- Beri nama variabel loop sesuai apa yang dihitung (`n`, `k`, `m`) — ini mendokumentasikan kompleksitas sambil menulis kode

## Cara membangun kemampuan ini

1. Pelajari toolkit kecil di atas (~6 bentuk) — jangan hafalkan katalog raksasa
2. Untuk setiap loop/rekursi yang ditulis, tanyakan "apa yang saya iterasi, seberapa besar, bersarang atau berurutan?"
3. Latih menurunkan Big-O pada kode yang sudah dipahami sebelum mengecek jawabannya
4. Saat melihat huruf yang belum familiar, tanyakan apa yang dihitungnya — hampir selalu bisa dijawab dari konteks
5. Sumber bagus: *Grokking Algorithms* oleh Aditya Bhargava (visual, ramah untuk pemula)
</div>