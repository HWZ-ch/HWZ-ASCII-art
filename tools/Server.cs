using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace AsciiStudio
{
    internal static class Program
    {
        private static void Main(string[] args)
        {
            try { Console.OutputEncoding = Encoding.UTF8; } catch { }

            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            bool noOpen = false;
            foreach (string arg in args)
            {
                if (string.Equals(arg, "--no-open", StringComparison.OrdinalIgnoreCase)) noOpen = true;
            }

            TcpListener listener = null;
            int port = 0;
            for (int candidate = 8765; candidate < 8800; candidate++)
            {
                try
                {
                    TcpListener probe = new TcpListener(IPAddress.Loopback, candidate);
                    probe.Start();
                    listener = probe;
                    port = candidate;
                    break;
                }
                catch (SocketException)
                {
                    // Port is in use; try the next one.
                }
            }

            if (listener == null)
            {
                Console.WriteLine("无法启动本地服务：8765-8799 端口都被占用。");
                Console.WriteLine("请关闭占用端口的程序后重试。");
                Console.ReadLine();
                return;
            }

            ThreadPool.SetMinThreads(16, 16);
            LocalServer server = new LocalServer(listener, root);
            server.Start();

            string url = "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/";
            Console.WriteLine();
            Console.WriteLine("  字符映画 · 本地服务已启动");
            Console.WriteLine("  " + url);
            Console.WriteLine();
            Console.WriteLine("  浏览器会自动打开。");
            Console.WriteLine();

            if (!noOpen)
            {
                try
                {
                    ProcessStartInfo info = new ProcessStartInfo(url);
                    info.UseShellExecute = true;
                    Process.Start(info);
                }
                catch (Exception)
                {
                    Console.WriteLine("  未能自动打开浏览器，请手动访问上面的地址。");
                }
            }

            Console.WriteLine("  关闭此窗口即可停止工具。");
            Thread.Sleep(Timeout.Infinite);
        }
    }

    internal sealed class LocalServer
    {
        private readonly TcpListener listener;
        private readonly string root;
        private readonly string rootPrefix;
        private volatile bool running = true;

        public LocalServer(TcpListener listener, string root)
        {
            this.listener = listener;
            this.root = root;
            this.rootPrefix = root + Path.DirectorySeparatorChar;
        }

        public void Start()
        {
            Thread thread = new Thread(AcceptLoop);
            thread.IsBackground = true;
            thread.Name = "AsciiStudioHttp";
            thread.Start();
        }

        public void Stop()
        {
            running = false;
            try { listener.Stop(); } catch { }
        }

        private void AcceptLoop()
        {
            while (running)
            {
                TcpClient client = null;
                try
                {
                    client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(HandleClient, client);
                }
                catch (SocketException)
                {
                    if (!running) return;
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                catch
                {
                    try { if (client != null) client.Close(); } catch { }
                }
            }
        }

        private void HandleClient(object state)
        {
            TcpClient client = (TcpClient)state;
            NetworkStream stream = null;
            try
            {
                client.ReceiveTimeout = 30000;
                client.SendTimeout = 30000;
                stream = client.GetStream();

                string headerText;
                if (!ReadHeader(stream, out headerText)) return;

                string[] lines = headerText.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                if (lines.Length == 0) return;

                string[] request = lines[0].Split(' ');
                if (request.Length < 3)
                {
                    WriteText(stream, 400, "Bad Request", "text/plain; charset=utf-8", "Bad Request");
                    return;
                }

                string method = request[0].ToUpperInvariant();
                if (method != "GET" && method != "HEAD")
                {
                    WriteText(stream, 405, "Method Not Allowed", "text/plain; charset=utf-8", "Method Not Allowed");
                    return;
                }

                string rangeHeader = null;
                for (int i = 1; i < lines.Length; i++)
                {
                    int colon = lines[i].IndexOf(':');
                    if (colon <= 0) continue;
                    string name = lines[i].Substring(0, colon).Trim();
                    if (string.Equals(name, "Range", StringComparison.OrdinalIgnoreCase))
                    {
                        rangeHeader = lines[i].Substring(colon + 1).Trim();
                    }
                }

                string target = request[1];
                int query = target.IndexOf('?');
                if (query >= 0) target = target.Substring(0, query);
                string path;
                try { path = Uri.UnescapeDataString(target); }
                catch { path = target; }

                if (string.IsNullOrEmpty(path) || path == "/") path = "/index.html";
                if (path.EndsWith("/", StringComparison.Ordinal)) path += "index.html";

                string relative = path.Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
                string fullPath = Path.GetFullPath(Path.Combine(root, relative));
                if (!fullPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    WriteText(stream, 403, "Forbidden", "text/plain; charset=utf-8", "Forbidden");
                    return;
                }

                if (!File.Exists(fullPath))
                {
                    WriteText(stream, 404, "Not Found", "text/plain; charset=utf-8", "Not Found");
                    return;
                }

                FileInfo info = new FileInfo(fullPath);
                long size = info.Length;
                string contentType = GetContentType(fullPath);

                long start = 0;
                long end = size > 0 ? size - 1 : 0;
                bool partial = false;

                if (!string.IsNullOrEmpty(rangeHeader) && rangeHeader.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
                {
                    string spec = rangeHeader.Substring(6).Split(',')[0].Trim();
                    int dash = spec.IndexOf('-');
                    if (dash >= 0)
                    {
                        string left = spec.Substring(0, dash).Trim();
                        string right = spec.Substring(dash + 1).Trim();
                        long parsed;
                        if (left.Length == 0)
                        {
                            if (long.TryParse(right, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) && parsed > 0)
                            {
                                start = Math.Max(0, size - parsed);
                                end = size - 1;
                                partial = true;
                            }
                        }
                        else if (long.TryParse(left, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
                        {
                            start = parsed;
                            if (right.Length > 0 && long.TryParse(right, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
                            {
                                end = Math.Min(parsed, size - 1);
                            }
                            else
                            {
                                end = size - 1;
                            }
                            partial = true;
                        }
                    }

                    if (size == 0 || start < 0 || start >= size || end < start)
                    {
                        string invalid = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" +
                            size.ToString(CultureInfo.InvariantCulture) + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                        WriteAscii(stream, invalid);
                        return;
                    }
                }

                long length = end - start + 1;
                StringBuilder headers = new StringBuilder();
                headers.Append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
                headers.Append("Content-Type: ").Append(contentType).Append("\r\n");
                headers.Append("Content-Length: ").Append(length.ToString(CultureInfo.InvariantCulture)).Append("\r\n");
                headers.Append("Accept-Ranges: bytes\r\n");
                headers.Append("Cache-Control: no-store, no-cache, must-revalidate\r\n");
                if (partial)
                {
                    headers.Append("Content-Range: bytes ")
                        .Append(start.ToString(CultureInfo.InvariantCulture)).Append("-")
                        .Append(end.ToString(CultureInfo.InvariantCulture)).Append("/")
                        .Append(size.ToString(CultureInfo.InvariantCulture)).Append("\r\n");
                }
                headers.Append("Connection: close\r\n\r\n");
                WriteAscii(stream, headers.ToString());

                if (method == "HEAD") return;

                using (FileStream file = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    file.Seek(start, SeekOrigin.Begin);
                    byte[] buffer = new byte[64 * 1024];
                    long remaining = length;
                    while (remaining > 0)
                    {
                        int want = (int)Math.Min(buffer.Length, remaining);
                        int read = file.Read(buffer, 0, want);
                        if (read <= 0) break;
                        stream.Write(buffer, 0, read);
                        remaining -= read;
                    }
                }
            }
            catch (IOException) { }
            catch (SocketException) { }
            catch (ObjectDisposedException) { }
            catch (Exception error)
            {
                try
                {
                    if (stream != null)
                    {
                        WriteText(stream, 500, "Internal Server Error", "text/plain; charset=utf-8", error.Message);
                    }
                }
                catch { }
            }
            finally
            {
                try { if (stream != null) stream.Close(); } catch { }
                try { client.Close(); } catch { }
            }
        }

        private static bool ReadHeader(NetworkStream stream, out string header)
        {
            header = null;
            MemoryStream memory = new MemoryStream();
            byte[] buffer = new byte[8192];
            int total = 0;
            while (total < 32768)
            {
                int read = stream.Read(buffer, 0, buffer.Length);
                if (read <= 0) return false;
                memory.Write(buffer, 0, read);
                total += read;
                byte[] all = memory.GetBuffer();
                if (total >= 4 &&
                    all[total - 4] == 13 &&
                    all[total - 3] == 10 &&
                    all[total - 2] == 13 &&
                    all[total - 1] == 10)
                {
                    header = Encoding.ASCII.GetString(all, 0, total);
                    return true;
                }
            }
            return false;
        }

        private static void WriteAscii(NetworkStream stream, string text)
        {
            byte[] bytes = Encoding.ASCII.GetBytes(text);
            stream.Write(bytes, 0, bytes.Length);
        }

        private static void WriteText(NetworkStream stream, int status, string statusText, string contentType, string body)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(body ?? string.Empty);
            StringBuilder headers = new StringBuilder();
            headers.Append("HTTP/1.1 ").Append(status.ToString(CultureInfo.InvariantCulture)).Append(' ').Append(statusText).Append("\r\n");
            headers.Append("Content-Type: ").Append(contentType).Append("\r\n");
            headers.Append("Content-Length: ").Append(bytes.Length.ToString(CultureInfo.InvariantCulture)).Append("\r\n");
            headers.Append("Cache-Control: no-store\r\n");
            headers.Append("Connection: close\r\n\r\n");
            WriteAscii(stream, headers.ToString());
            stream.Write(bytes, 0, bytes.Length);
        }

        private static string GetContentType(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            switch (ext)
            {
                case ".html": return "text/html; charset=utf-8";
                case ".htm": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".mjs": return "text/javascript; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".txt": return "text/plain; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".webp": return "image/webp";
                case ".gif": return "image/gif";
                case ".ico": return "image/x-icon";
                case ".mp4":
                case ".m4v": return "video/mp4";
                case ".webm": return "video/webm";
                case ".ogv":
                case ".ogg": return "video/ogg";
                case ".mov": return "video/quicktime";
                case ".mkv": return "video/x-matroska";
                case ".mp3": return "audio/mpeg";
                case ".wav": return "audio/wav";
                case ".woff": return "font/woff";
                case ".woff2": return "font/woff2";
                default: return "application/octet-stream";
            }
        }
    }
}
