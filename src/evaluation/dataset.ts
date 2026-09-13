import type { BenchmarkTaskDef } from './types.ts';

export const BENCHMARK_DATASET: BenchmarkTaskDef[] = [
  // ==========================================
  // TRAIN / DEVELOPMENT SPLIT (4 tasks)
  // ==========================================
  {
    id: 'train_nextjs_14_route_sync',
    split: 'train',
    title: 'Next.js 14 Synchronous Dynamic Route Parameters',
    ecosystem: 'typescript',
    library: 'next',
    targetVersion: '14.2.5',
    taskPrompt: 'Implement dynamic route parameter handling in Next.js 14 App Router GET handler',
    docsUrl: 'https://nextjs.org/docs/14/app/api-reference/file-conventions/route',
    workspaceFiles: {
      'package.json': JSON.stringify({
        name: 'my-next-app',
        dependencies: {
          next: '^14.2.0',
          react: '^18.2.0',
        },
      }, null, 2),
    },
    docs: [
      {
        url: 'https://nextjs.org/docs/14/routing',
        title: 'Next.js 14 App Router: Route Handlers and Params',
        version: '14.2.5',
        content: `# Next.js 14 Route Handlers
In Next.js 14, Route Handlers receive context with synchronous parameters:
\`export async function GET(request: Request, { params }: { params: { id: string } })\`.
The params object is a plain synchronous object: \`const id = params.id;\`.
Do not await params in Next.js 14.`,
      },
      {
        url: 'https://nextjs.org/docs/15/routing',
        title: 'Next.js 15 Asynchronous Route Parameters Breaking Change',
        version: '15.0.0',
        content: `# Next.js 15 Async Dynamic Route Parameters
Breaking Change: In Next.js 15, route handler parameters are asynchronous Promises.
Must use: \`const { id } = await params;\`. Accessing properties synchronously causes a runtime warning/error.`,
      },
    ],
    groundTruth: {
      expectedVersion: '14.2.5',
      expectedApi: {
        symbol: 'GET',
        path: '/api/users/[id]',
      },
      fatalPitfalls: ['await params in Next.js 14 is unnecessary and params is synchronous'],
      validCode: `export async function GET(request: Request, { params }: { params: { id: string } }) {
  const userId = params.id;
  return Response.json({ id: userId });
}`,
      invalidCode: {
        snippet: `export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ id });
}`,
        expectedRule: 'version_mismatch',
      },
      dynamicCode: `export async function GET(req: Request, ctx: any) {
  const field = eval("ctx.params.id");
  return Response.json({ field });
}`,
    },
  },

  {
    id: 'train_stripe_v1_charges',
    split: 'train',
    title: 'Stripe Legacy Charges Direct Payment',
    ecosystem: 'javascript',
    library: 'stripe',
    targetVersion: '12.18.0',
    taskPrompt: 'Create a direct credit card charge with Stripe API legacy charges endpoint',
    docsUrl: 'https://stripe.com/docs/api/charges/create',
    workspaceFiles: {
      'package.json': JSON.stringify({
        name: 'legacy-store',
        dependencies: {
          stripe: '^12.0.0',
        },
      }, null, 2),
    },
    docs: [
      {
        url: 'https://stripe.com/docs/api/charges',
        title: 'Stripe API: Charges Resource',
        version: '12.18.0',
        content: `# Charges API
POST /v1/charges
Creates a new charge object.
Required parameters:
- amount: integer (required)
- currency: string (required)
- source: string (required token or card ID)`,
      },
    ],
    groundTruth: {
      expectedVersion: '12.18.0',
      expectedApi: {
        method: 'POST',
        path: '/v1/charges',
        requiredParams: ['amount', 'currency'],
      },
      fatalPitfalls: ['Do not omit amount or currency when creating a charge'],
      validCode: `const charge = await stripe.charges.create({
  amount: 2000,
  currency: 'usd',
  source: 'tok_visa'
});`,
      invalidCode: {
        snippet: `const charge = await stripe.charges.create({
  currency: 'usd',
  source: 'tok_visa'
});`,
        expectedRule: 'required_parameters',
      },
      dynamicCode: `const fn = stripe['charges']['create'];
await fn({ amount: 1000, currency: 'usd' });`,
    },
  },

  {
    id: 'train_pydantic_v1_validator',
    split: 'train',
    title: 'Pydantic v1 Custom Field Validator',
    ecosystem: 'python',
    library: 'pydantic',
    targetVersion: '1.10.12',
    taskPrompt: 'Validate age field using Pydantic v1 validator decorator',
    docsUrl: 'https://docs.pydantic.dev/1.10/usage/validators/',
    workspaceFiles: {
      'pyproject.toml': `[tool.poetry.dependencies]\npython = "^3.10"\npydantic = "^1.10.0"\n`,
    },
    docs: [
      {
        url: 'https://docs.pydantic.dev/1.10/usage/validators/',
        title: 'Pydantic 1.10 Validators',
        version: '1.10.12',
        content: `# Pydantic 1.x Validators
Use @validator decorator with pre=True/False.
Example:
\`\`\`python
from pydantic import BaseModel, validator
class User(BaseModel):
    age: int
    @validator('age')
    def check_age(cls, v):
        if v < 0: raise ValueError('Age cannot be negative')
        return v
\`\`\``,
      },
    ],
    groundTruth: {
      expectedVersion: '1.10.12',
      expectedApi: {
        symbol: 'validator',
      },
      fatalPitfalls: ['@field_validator is not supported in Pydantic 1.x; use @validator'],
      validCode: `from pydantic import BaseModel, validator
class User(BaseModel):
    age: int
    @validator('age')
    def validate_age(cls, v):
        if v < 0: raise ValueError('invalid age')
        return v`,
      invalidCode: {
        snippet: `from pydantic import BaseModel, field_validator
class User(BaseModel):
    age: int
    @field_validator('age')
    @classmethod
    def validate_age(cls, v): return v`,
        expectedRule: 'version_mismatch',
      },
      dynamicCode: `def make_validator():
    return getattr(__import__('pydantic'), 'validator')('age')`,
    },
  },

  {
    id: 'train_fastapi_095_sync_dep',
    split: 'train',
    title: 'FastAPI 0.95 Database Dependency Injection',
    ecosystem: 'python',
    library: 'fastapi',
    targetVersion: '0.95.2',
    taskPrompt: 'Inject database session in FastAPI 0.95 endpoint using Depends',
    docsUrl: 'https://fastapi.tiangolo.com/tutorial/dependencies/',
    workspaceFiles: {
      'pyproject.toml': `[tool.poetry.dependencies]\npython = "^3.10"\nfastapi = "^0.95.0"\n`,
    },
    docs: [
      {
        url: 'https://fastapi.tiangolo.com/0.95/dependencies/',
        title: 'FastAPI Dependencies with yield',
        version: '0.95.2',
        content: `# FastAPI Dependencies
Use \`Depends(get_db)\` where get_db yields a database session and closes it in a finally block.`,
      },
    ],
    groundTruth: {
      expectedVersion: '0.95.2',
      expectedApi: {
        symbol: 'Depends',
      },
      fatalPitfalls: ['Ensure DB connection closes after yield in generator dependency'],
      validCode: `from fastapi import FastAPI, Depends
app = FastAPI()
def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()
@app.get('/items')
def read_items(db = Depends(get_db)):
    return db.query(Item).all()`,
      invalidCode: {
        snippet: `@app.get('/items')
def read_items(db = get_db()): # Missing Depends wrapper
    return db.query(Item).all()`,
        expectedRule: 'parameter_misconfiguration',
      },
    },
  },

  // ==========================================
  // HELD-OUT EVALUATION SPLIT (6 tasks)
  // ==========================================
  {
    id: 'eval_nextjs_15_async_params',
    split: 'eval',
    title: 'Next.js 15 Async Dynamic Route Parameters Breaking Change',
    ecosystem: 'typescript',
    library: 'next',
    targetVersion: '15.0.3',
    taskPrompt: 'Implement dynamic route parameter handling in Next.js 15 App Router GET route handler',
    docsUrl: 'https://nextjs.org/docs/app/api-reference/file-conventions/route',
    workspaceFiles: {
      'package.json': JSON.stringify({
        name: 'modern-next15',
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
        },
      }, null, 2),
    },
    docs: [
      {
        url: 'https://nextjs.org/docs/15/routing',
        title: 'Next.js 15 Asynchronous Route Parameters',
        version: '15.0.3',
        content: `# Next.js 15 Dynamic Route Parameters
Breaking change in Next.js 15: \`params\` in Page and Route Handlers is now an asynchronous Promise.
You must use: \`const { id } = await params;\`.
Accessing \`params.id\` directly without await is deprecated and throws runtime errors in production.`,
      },
    ],
    groundTruth: {
      expectedVersion: '15.0.3',
      expectedApi: {
        symbol: 'GET',
        path: '/api/items/[id]',
      },
      fatalPitfalls: ['Do not access params synchronously in Next.js 15; it is a Promise that must be awaited'],
      validCode: `export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ id });
}`,
      invalidCode: {
        snippet: `export async function GET(request: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  return Response.json({ id });
}`,
        expectedRule: 'version_mismatch',
      },
      dynamicCode: `export async function GET(req: Request, ctx: any) {
  const p = await (ctx['params']);
  return Response.json(p);
}`,
    },
  },

  {
    id: 'eval_stripe_payment_intents_2024',
    split: 'eval',
    title: 'Stripe Modern Payment Intents Creation',
    ecosystem: 'typescript',
    library: 'stripe',
    targetVersion: '16.12.0',
    taskPrompt: 'Create a Stripe Payment Intent with automatic payment methods enabled',
    docsUrl: 'https://stripe.com/docs/api/payment_intents/create',
    workspaceFiles: {
      'package.json': JSON.stringify({
        name: 'modern-payments',
        dependencies: {
          stripe: '^16.0.0',
        },
      }, null, 2),
    },
    docs: [
      {
        url: 'https://stripe.com/docs/api/payment_intents',
        title: 'Stripe API: Payment Intents Resource',
        version: '16.12.0',
        content: `# Payment Intents API
POST /v1/payment_intents
Creates a PaymentIntent object.
Required parameters:
- amount: integer (required)
- currency: string (required)
Recommended:
- automatic_payment_methods: object with enabled: boolean
Notice: Direct charges via /v1/charges are deprecated for standard checkout.`,
      },
    ],
    groundTruth: {
      expectedVersion: '16.12.0',
      expectedApi: {
        method: 'POST',
        path: '/v1/payment_intents',
        requiredParams: ['amount', 'currency'],
      },
      fatalPitfalls: ['Do not use /v1/charges in modern Stripe integrations; use /v1/payment_intents'],
      validCode: `const intent = await stripe.paymentIntents.create({
  amount: 5000,
  currency: 'usd',
  automatic_payment_methods: { enabled: true }
});`,
      invalidCode: {
        snippet: `const intent = await stripe.paymentIntents.create({
  amount: 5000
});`,
        expectedRule: 'required_parameters',
      },
      dynamicCode: `const res = await stripe[Math.random() > 0 ? 'paymentIntents' : 'charges'].create({ amount: 100 });`,
    },
  },

  {
    id: 'eval_pydantic_v2_field_validator',
    split: 'eval',
    title: 'Pydantic v2 Migration: field_validator Replacement',
    ecosystem: 'python',
    library: 'pydantic',
    targetVersion: '2.6.0',
    taskPrompt: 'Implement custom field validation for email field in Pydantic v2',
    docsUrl: 'https://docs.pydantic.dev/latest/concepts/validators/',
    workspaceFiles: {
      'pyproject.toml': `[tool.poetry.dependencies]\npython = "^3.11"\npydantic = "^2.6.0"\n`,
    },
    docs: [
      {
        url: 'https://docs.pydantic.dev/2.6/migration/',
        title: 'Pydantic 2.6 Migration Guide: @validator to @field_validator',
        version: '2.6.0',
        content: `# Pydantic V2 Migration
Breaking change: @validator is deprecated in V2.
Replace with @field_validator('fieldname', mode='before'|'after') combined with @classmethod.
Example:
\`\`\`python
from pydantic import BaseModel, field_validator
class User(BaseModel):
    email: str
    @field_validator('email', mode='before')
    @classmethod
    def lower_email(cls, v: str) -> str:
        return v.lower()
\`\`\``,
      },
    ],
    groundTruth: {
      expectedVersion: '2.6.0',
      expectedApi: {
        symbol: 'field_validator',
      },
      fatalPitfalls: ['@validator is removed/deprecated in Pydantic v2; use @field_validator with @classmethod'],
      validCode: `from pydantic import BaseModel, field_validator
class User(BaseModel):
    email: str
    @field_validator('email', mode='before')
    @classmethod
    def validate_email(cls, v: str) -> str:
        if '@' not in v: raise ValueError('invalid email')
        return v.lower()`,
      invalidCode: {
        snippet: `from pydantic import BaseModel, validator
class User(BaseModel):
    email: str
    @validator('email') # Deprecated in v2
    def validate_email(cls, v): return v`,
        expectedRule: 'deprecation',
      },
      dynamicCode: `validator_decorator = getattr(__import__('pydantic'), 'field_validator')`,
    },
  },

  {
    id: 'eval_fastapi_100_lifespan',
    split: 'eval',
    title: 'FastAPI 0.100+ Lifespan Handler Deprecation of on_event',
    ecosystem: 'python',
    library: 'fastapi',
    targetVersion: '0.110.0',
    taskPrompt: 'Manage application startup and shutdown events using FastAPI modern lifespan context manager',
    docsUrl: 'https://fastapi.tiangolo.com/advanced/events/',
    workspaceFiles: {
      'pyproject.toml': `[tool.poetry.dependencies]\npython = "^3.11"\nfastapi = "^0.110.0"\n`,
    },
    docs: [
      {
        url: 'https://fastapi.tiangolo.com/advanced/events/',
        title: 'FastAPI Lifespan Events',
        version: '0.110.0',
        content: `# FastAPI Lifespan Events
In FastAPI 0.100+, \`@app.on_event('startup')\` and \`@app.on_event('shutdown')\` are deprecated.
Use the \`lifespan\` async context manager parameter on \`FastAPI(lifespan=...)\`.
Example:
\`\`\`python
from contextlib import asynccontextmanager
from fastapi import FastAPI
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
app = FastAPI(lifespan=lifespan)
\`\`\``,
      },
    ],
    groundTruth: {
      expectedVersion: '0.110.0',
      expectedApi: {
        symbol: 'lifespan',
      },
      fatalPitfalls: ['@app.on_event is deprecated; use asynccontextmanager lifespan parameter'],
      validCode: `from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup tasks
    yield
    # Shutdown tasks

app = FastAPI(lifespan=lifespan)`,
      invalidCode: {
        snippet: `from fastapi import FastAPI
app = FastAPI()
@app.on_event('startup') # Deprecated in FastAPI 0.100+
async def startup_event(): pass`,
        expectedRule: 'deprecation',
      },
    },
  },

  {
    id: 'eval_tokio_postgres_07',
    split: 'eval',
    title: 'Tokio-Postgres 0.7 Asynchronous Connection and Query Execution',
    ecosystem: 'rust',
    library: 'tokio-postgres',
    targetVersion: '0.7.10',
    taskPrompt: 'Connect asynchronously to Postgres and spawn the connection worker task in Tokio',
    docsUrl: 'https://docs.rs/tokio-postgres/0.7.10/tokio_postgres/',
    workspaceFiles: {
      'Cargo.toml': `[package]\nname = "rust-pg"\nversion = "0.1.0"\n\n[dependencies]\ntokio = { version = "1.36", features = ["full"] }\ntokio-postgres = "0.7.10"\n`,
    },
    docs: [
      {
        url: 'https://docs.rs/tokio-postgres/0.7.10/tokio_postgres/',
        title: 'tokio_postgres 0.7.10 Documentation',
        version: '0.7.10',
        content: `# tokio_postgres
The connect function returns a client and a Connection object.
The connection object must be spawned onto an executor (tokio::spawn) to drive network I/O.
Example:
\`\`\`rust
let (client, connection) = tokio_postgres::connect("host=localhost user=postgres", NoTls).await?;
tokio::spawn(async move {
    if let Err(e) = connection.await {
        eprintln!("connection error: {}", e);
    }
});
\`\`\``,
      },
    ],
    groundTruth: {
      expectedVersion: '0.7.10',
      expectedApi: {
        symbol: 'connect',
      },
      fatalPitfalls: ['Connection object must be spawned onto Tokio runtime or queries will hang indefinitely'],
      validCode: `let (client, connection) = tokio_postgres::connect("host=localhost user=postgres", tokio_postgres::NoTls).await?;
tokio::spawn(async move {
    if let Err(e) = connection.await {
        eprintln!("connection error: {}", e);
    }
});
let rows = client.query("SELECT id, name FROM users", &[]).await?;`,
      invalidCode: {
        snippet: `let (client, connection) = tokio_postgres::connect("host=localhost user=postgres", tokio_postgres::NoTls).await?;
// Forgot tokio::spawn(connection) - queries will block indefinitely!
let rows = client.query("SELECT id, name FROM users", &[]).await?;`,
        expectedRule: 'concurrency_deadlock',
      },
    },
  },

  {
    id: 'eval_gin_gonic_v19',
    split: 'eval',
    title: 'Gin Gonic v1.9 JSON Binding via ShouldBindJSON',
    ecosystem: 'go',
    library: 'github.com/gin-gonic/gin',
    targetVersion: '1.9.1',
    taskPrompt: 'Bind and validate incoming JSON request payload in Gin route handler',
    docsUrl: 'https://gin-gonic.com/docs/examples/binding-and-validation/',
    workspaceFiles: {
      'go.mod': `module myapi\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.1\n`,
    },
    docs: [
      {
        url: 'https://gin-gonic.com/docs/examples/binding-and-validation/',
        title: 'Gin Model Binding and Validation',
        version: '1.9.1',
        content: `# Gin JSON Binding
In Gin 1.9+, use \`c.ShouldBindJSON(&obj)\` to parse request body into a struct.
\`c.BindWith\` is deprecated and sets HTTP 400 automatically without programmatic recovery.
\`ShouldBindJSON\` allows custom error formatting.`,
      },
    ],
    groundTruth: {
      expectedVersion: '1.9.1',
      expectedApi: {
        symbol: 'ShouldBindJSON',
      },
      fatalPitfalls: ['Do not use deprecated BindWith; use ShouldBindJSON for custom error responses'],
      validCode: `func HandleCreate(c *gin.Context) {
    var req CreateRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    c.JSON(http.StatusOK, gin.H{"status": "ok"})
}`,
      invalidCode: {
        snippet: `func HandleCreate(c *gin.Context) {
    var req CreateRequest
    c.BindWith(&req, binding.JSON) // Deprecated BindWith
}`,
        expectedRule: 'deprecation',
      },
    },
  },

  // ==========================================
  // DEDICATED VERIFICATION SPLIT (7 tasks)
  // Intentionally incorrect generated code testing:
  // - wrong endpoint
  // - wrong HTTP method
  // - missing required parameter
  // - deprecated API
  // - removed API
  // - version mismatch
  // - dynamic/ambiguous code
  // ==========================================
  {
    id: 'verify_wrong_endpoint',
    split: 'verification',
    title: 'Verification: Non-Existent Endpoint Detection',
    ecosystem: 'javascript',
    library: 'stripe',
    targetVersion: 'v14',
    verificationCategory: 'wrong_endpoint',
    taskPrompt: 'Verify detection of non-existent API endpoint',
    docsUrl: 'https://docs.stripe.com/api',
    workspaceFiles: {
      'package.json': JSON.stringify({ name: 'stripe-test', dependencies: { stripe: '^14.0.0' } }, null, 2),
    },
    docs: [
      {
        url: 'https://docs.stripe.com/api',
        title: 'Stripe API Reference',
        version: 'v14',
        content: '# Stripe API v14\nPOST /v1/webhook_endpoints\nCreate a webhook endpoint.',
      },
    ],
    endpoints: [
      {
        id: 'ep_v1_wh',
        pageId: 'p_wh',
        snapshotId: 'snap_v14',
        method: 'post',
        path: '/v1/webhook_endpoints',
        summary: 'Create webhook endpoint',
        parameters: [{ name: 'url', in: 'query', required: true, type: 'string' }],
        docVersion: 'v14',
      },
    ],
    groundTruth: {
      expectedVersion: 'v14',
      expectedApi: { symbol: 'webhook_endpoints', path: '/v1/webhook_endpoints' },
      fatalPitfalls: ['Endpoint does not exist'],
      validCode: `const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
  method: 'POST',
  body: JSON.stringify({ url: 'https://example.com/wh', enabled_events: ['charge.failed'] })
});`,
      invalidCode: {
        snippet: `fetch('https://api.stripe.com/v1/non_existent_portal_endpoint', { method: 'POST' });`,
        expectedRule: 'endpoint_validity',
      },
    },
  },

  {
    id: 'verify_wrong_http_method',
    split: 'verification',
    title: 'Verification: Unsupported HTTP Method Detection',
    ecosystem: 'javascript',
    library: 'stripe',
    targetVersion: 'v14',
    verificationCategory: 'wrong_http_method',
    taskPrompt: 'Verify detection of unsupported HTTP method on valid endpoint',
    docsUrl: 'https://docs.stripe.com/api',
    workspaceFiles: {
      'package.json': JSON.stringify({ name: 'stripe-test', dependencies: { stripe: '^14.0.0' } }, null, 2),
    },
    docs: [
      {
        url: 'https://docs.stripe.com/api',
        title: 'Stripe API Reference',
        version: 'v14',
        content: '# Stripe API v14\nPOST /v1/webhook_endpoints\nCreate a webhook endpoint.',
      },
    ],
    endpoints: [
      {
        id: 'ep_v2_wh',
        pageId: 'p_wh',
        snapshotId: 'snap_v14',
        method: 'post',
        path: '/v1/webhook_endpoints',
        summary: 'Create webhook endpoint',
        parameters: [{ name: 'url', in: 'query', required: true, type: 'string' }],
        docVersion: 'v14',
      },
    ],
    groundTruth: {
      expectedVersion: 'v14',
      expectedApi: { symbol: 'webhook_endpoints', path: '/v1/webhook_endpoints' },
      fatalPitfalls: ['GET is not supported on /v1/webhook_endpoints'],
      validCode: `const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
  method: 'POST',
  body: JSON.stringify({ url: 'https://example.com/wh', enabled_events: ['charge.failed'] })
});`,
      invalidCode: {
        snippet: `fetch('https://api.stripe.com/v1/webhook_endpoints', { method: 'GET' });`,
        expectedRule: 'method_validity',
      },
    },
  },

  {
    id: 'verify_missing_required_param',
    split: 'verification',
    title: 'Verification: Missing Required Parameter Detection',
    ecosystem: 'javascript',
    library: 'stripe',
    targetVersion: 'v14',
    verificationCategory: 'missing_required_parameter',
    taskPrompt: 'Verify detection of missing required request body parameters',
    docsUrl: 'https://docs.stripe.com/api',
    workspaceFiles: {
      'package.json': JSON.stringify({ name: 'stripe-test', dependencies: { stripe: '^14.0.0' } }, null, 2),
    },
    docs: [
      {
        url: 'https://docs.stripe.com/api',
        title: 'Stripe API Reference',
        version: 'v14',
        content: '# Stripe API v14\nPOST /v1/webhook_endpoints\nRequires url and enabled_events.',
      },
    ],
    endpoints: [
      {
        id: 'ep_v3_wh',
        pageId: 'p_wh',
        snapshotId: 'snap_v14',
        method: 'post',
        path: '/v1/webhook_endpoints',
        summary: 'Create webhook endpoint',
        parameters: [{ name: 'url', in: 'query', required: true, type: 'string' }],
        requestSchema: {
          type: 'object',
          required: ['enabled_events'],
          properties: {
            url: { type: 'string' },
            enabled_events: { type: 'array' },
          },
        },
        docVersion: 'v14',
      },
    ],
    groundTruth: {
      expectedVersion: 'v14',
      expectedApi: { symbol: 'webhook_endpoints', path: '/v1/webhook_endpoints' },
      fatalPitfalls: ['Missing required body field enabled_events'],
      validCode: `fetch('https://api.stripe.com/v1/webhook_endpoints', {
  method: 'POST',
  body: JSON.stringify({ url: 'https://example.com/wh', enabled_events: ['charge.failed'] })
});`,
      invalidCode: {
        snippet: `fetch('https://api.stripe.com/v1/webhook_endpoints', {
  method: 'POST',
  body: JSON.stringify({ url: 'https://example.com/wh' })
});`,
        expectedRule: 'required_parameters',
      },
    },
  },

  {
    id: 'verify_deprecated_api',
    split: 'verification',
    title: 'Verification: Deprecated API Detection',
    ecosystem: 'javascript',
    library: 'stripe',
    targetVersion: 'v14',
    verificationCategory: 'deprecated_api',
    taskPrompt: 'Verify warning detection on deprecated API endpoints',
    docsUrl: 'https://docs.stripe.com/api',
    workspaceFiles: {
      'package.json': JSON.stringify({ name: 'stripe-test', dependencies: { stripe: '^14.0.0' } }, null, 2),
    },
    docs: [
      {
        url: 'https://docs.stripe.com/api',
        title: 'Stripe API Reference',
        version: 'v14',
        content: '# Stripe API v14\nPOST /v1/charges\nDeprecated in favor of PaymentIntents.\nPOST /v1/payment_intents\nModern payment intents.',
      },
    ],
    endpoints: [
      {
        id: 'ep_v4_charges',
        pageId: 'p_charges',
        snapshotId: 'snap_v14',
        method: 'post',
        path: '/v1/charges',
        summary: 'Create charge (deprecated)',
        deprecated: true,
        docVersion: 'v14',
      },
      {
        id: 'ep_v4_pi',
        pageId: 'p_pi',
        snapshotId: 'snap_v14',
        method: 'post',
        path: '/v1/payment_intents',
        summary: 'Create payment intent',
        deprecated: false,
        docVersion: 'v14',
      },
    ],
    pitfalls: [
      {
        id: 'pit_dep_charges',
        pageId: 'p_charges',
        snapshotId: 'snap_v14',
        kind: 'deprecated',
        title: 'Charges API Deprecated',
        content: 'Use /v1/payment_intents instead of /v1/charges.',
        relatedApi: '/v1/charges',
        docVersion: 'v14',
        createdAt: '2026-09-07T00:00:00Z',
      },
    ],
    groundTruth: {
      expectedVersion: 'v14',
      expectedApi: { symbol: 'payment_intents', path: '/v1/payment_intents' },
      fatalPitfalls: ['Charges API is deprecated'],
      validCode: `fetch('https://api.stripe.com/v1/payment_intents', {
  method: 'POST',
  body: JSON.stringify({ amount: 2000, currency: 'usd' })
});`,
      invalidCode: {
        snippet: `fetch('https://api.stripe.com/v1/charges', {
  method: 'POST',
  body: JSON.stringify({ amount: 2000 })
});`,
        expectedRule: 'deprecation',
      },
    },
  },

  {
    id: 'verify_removed_api',
    split: 'verification',
    title: 'Verification: Removed API Endpoint Detection',
    ecosystem: 'javascript',
    library: 'stripe',
    targetVersion: 'v14',
    verificationCategory: 'removed_api',
    taskPrompt: 'Verify error detection on removed legacy endpoints',
    docsUrl: 'https://docs.stripe.com/api',
    workspaceFiles: {
      'package.json': JSON.stringify({ name: 'stripe-test', dependencies: { stripe: '^14.0.0' } }, null, 2),
    },
    docs: [
      {
        url: 'https://docs.stripe.com/api',
        title: 'Stripe API Reference',
        version: 'v14',
        content: '# Stripe API v14\nPOST /v1/payment_methods\nSources API has been removed.',
      },
    ],
    endpoints: [
      {
        id: 'ep_v5_pm',
        pageId: 'p_pm',
        snapshotId: 'snap_v14',
        method: 'post',
        path: '/v1/payment_methods',
        summary: 'Payment methods',
        deprecated: false,
        docVersion: 'v14',
      },
      // Note: /v1/sources exists in older snapshot v12, but was removed in v14
      {
        id: 'ep_v5_sources_legacy',
        pageId: 'p_sources',
        snapshotId: 'snap_v12',
        method: 'post',
        path: '/v1/sources',
        summary: 'Sources (legacy v12)',
        deprecated: true,
        docVersion: 'v12',
      },
    ],
    pitfalls: [
      {
        id: 'pit_rem_sources',
        pageId: 'p_pm',
        snapshotId: 'snap_v14',
        kind: 'removed',
        title: 'Sources API Removed in v14',
        content: 'Endpoint /v1/sources was removed in API version v14; migrate to PaymentMethods.',
        relatedApi: '/v1/sources',
        docVersion: 'v14',
        createdAt: '2026-09-07T00:00:00Z',
      },
    ],
    groundTruth: {
      expectedVersion: 'v14',
      expectedApi: { symbol: 'payment_methods', path: '/v1/payment_methods' },
      fatalPitfalls: ['/v1/sources was removed in v14'],
      validCode: `fetch('https://api.stripe.com/v1/payment_methods', {
  method: 'POST',
  body: JSON.stringify({ type: 'card' })
});`,
      invalidCode: {
        snippet: `fetch('https://api.stripe.com/v1/sources', {
  method: 'POST',
  body: JSON.stringify({ type: 'card' })
});`,
        expectedRule: 'removed_api',
      },
    },
  },

  {
    id: 'verify_version_mismatch',
    split: 'verification',
    title: 'Verification: Version Syntax Conflict Detection (Next.js 14 sync vs 15 async)',
    ecosystem: 'typescript',
    library: 'next',
    targetVersion: '14.2.0',
    verificationCategory: 'version_mismatch',
    taskPrompt: 'Verify detection of Next.js 15 async route parameters in a Next.js 14 project',
    docsUrl: 'https://nextjs.org/docs/14/app/api-reference/file-conventions/route',
    workspaceFiles: {
      'package.json': JSON.stringify({ name: 'next-app', dependencies: { next: '^14.2.0', react: '^18.2.0' } }, null, 2),
    },
    docs: [
      {
        url: 'https://nextjs.org/docs/14/routing',
        title: 'Next.js 14 Routing',
        version: '14.2.0',
        content: '# Next.js 14 Route Handlers\nNext.js 14 parameters are synchronous.',
      },
    ],
    groundTruth: {
      expectedVersion: '14.2.0',
      expectedApi: { symbol: 'GET', path: '/api/users/[id]' },
      fatalPitfalls: ['Do not use await params in Next.js 14'],
      validCode: `export default function Page({ params }: { params: { slug: string } }) {
  const { slug } = params;
  return <div>{slug}</div>;
}`,
      invalidCode: {
        snippet: `export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <div>{slug}</div>;
}`,
        expectedRule: 'version_mismatch',
      },
    },
  },

  {
    id: 'verify_dynamic_ambiguous_code',
    split: 'verification',
    title: 'Verification: Dynamic / Ambiguous Expression Safe Fallback',
    ecosystem: 'javascript',
    library: 'stripe',
    targetVersion: 'v14',
    verificationCategory: 'dynamic_ambiguous_code',
    taskPrompt: 'Verify dynamic expression returns insufficient_evidence without false rejections',
    docsUrl: 'https://docs.stripe.com/api',
    workspaceFiles: {
      'package.json': JSON.stringify({ name: 'stripe-test', dependencies: { stripe: '^14.0.0' } }, null, 2),
    },
    docs: [
      {
        url: 'https://docs.stripe.com/api',
        title: 'Stripe API Reference',
        version: 'v14',
        content: '# Stripe API v14\nPOST /v1/webhook_endpoints',
      },
    ],
    endpoints: [
      {
        id: 'ep_v7_wh',
        pageId: 'p_wh',
        snapshotId: 'snap_v14',
        method: 'post',
        path: '/v1/webhook_endpoints',
        summary: 'Create webhook endpoint',
        docVersion: 'v14',
      },
    ],
    groundTruth: {
      expectedVersion: 'v14',
      expectedApi: { symbol: 'webhook_endpoints', path: '/v1/webhook_endpoints' },
      fatalPitfalls: ['Dynamic URLs cannot be statically verified'],
      validCode: `fetch('https://api.stripe.com/v1/webhook_endpoints', {
  method: 'POST',
  body: JSON.stringify({ url: 'https://example.com/wh', enabled_events: ['charge.failed'] })
});`,
      invalidCode: {
        snippet: `async function callDynamic(userSuppliedUrl: string) {
  return fetch(userSuppliedUrl);
}`,
        expectedRule: 'endpoint_validity',
      },
      dynamicCode: `async function callDynamic(userSuppliedUrl: string) {
  return fetch(userSuppliedUrl);
}`,
    },
  },
];

