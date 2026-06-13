/* Service Worker：把程序文件缓存下来，实现"装到手机后断网也能用"。
   改了网页文件后，把下面的版本号 +1，用户下次联网打开就会自动更新。 */
const CACHE = "shouchong-v11";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "merge.js",
  "sync.js",
  "timer.js",
  "app.js",
  "share.js",
  "manifest.webmanifest",
  "icon.svg",
];

// 安装：把核心文件存进缓存
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// 激活：清掉旧版本缓存
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 取用：先用缓存快速响应，同时后台拉取最新版更新缓存（Stale-While-Revalidate）
//       下次访问就能拿到新版，不再需要手动清缓存。
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(e.request, { ignoreSearch: true }).then((cached) => {
        // 后台网络请求，拿到新内容就更新缓存
        const fetched = fetch(e.request).then((response) => {
          if (response && response.status === 200) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(() => cached); // 断网时退回到缓存
        // 优先返回缓存（快），缓存为空时才等网络
        return cached || fetched;
      })
    )
  );
});
