/* Service Worker：把程序文件缓存下来，实现"装到手机后断网也能用"。
   改了网页文件后，把下面的版本号 +1，用户下次联网打开就会自动更新。 */
const CACHE = "shouchong-v7";
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

// 取用：缓存优先，忽略查询参数（?v=3 等版本号）；没有再联网
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) => hit || fetch(e.request).catch(() => caches.match("index.html"))
    )
  );
});
