#!/usr/bin/env node
"use strict";

import express from "express";
import {hhproxy} from "./proxy1.js";

const app = express();

// Uncomment the next line if you want to trust the proxy
// app.enable("trust proxy");
app.disable("x-powered-by");

app.get("/", hhproxy);
app.get("/favicon.ico", (req, res) => res.status(204).end());

export default app;
