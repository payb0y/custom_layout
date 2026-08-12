module.exports = {
  testDir: "./tests",
  timeout: 30000,
  workers: 1, // tests mutate instance-wide appconfig; never run them in parallel
  reporter: "list",
  use: {
    baseURL: "http://nextcloud.local:8080",
    headless: true,
    ignoreHTTPSErrors: true,
  },
};
