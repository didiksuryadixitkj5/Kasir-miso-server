import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Backups may include locally stored QRIS/menu images as data URLs. Keep the
// request limit explicit and high enough for a normal warung backup instead of
// letting Express reject it with its default 100kb HTML error page.
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use("/api", router);

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (
    typeof error === "object"
    && error !== null
    && "type" in error
    && error.type === "entity.too.large"
  ) {
    return res.status(413).json({
      message: "Backup terlalu besar untuk dikirim. Hapus gambar yang tidak diperlukan lalu coba lagi.",
    });
  }
  return next(error);
});

export default app;
