import { encode } from 'jwt-simple'
import log from 'loglevel'
import { type TxOperations, systemAccountUuid } from '@hcengineering/core'
import { type WorkspaceLoginInfo, getClient as getAccountClient } from '@hcengineering/account-client'
import { type RestClient, createRestClient, createRestTxOperations } from '@hcengineering/api-client'

interface ApiContext {
  workspaceUrl: string
  personUuid?: string
}

export interface SuccessResult<T> {
  ok: true
  data: T
}

export interface ErrorResult {
  ok: false
  status: number
}

type ApiResult<T> = SuccessResult<T> | ErrorResult

const cachedWorkspaces = new Map<string, WorkspaceLoginInfo>()

interface ClientHandler<T> {
      tx: false
      method: (client: RestClient, wsInfo: WorkspaceLoginInfo) => Promise<T>
    }

interface TxHandler<T> {
      tx: true
      method: (client: TxOperations, wsInfo: WorkspaceLoginInfo) => Promise<T>
    }

type ApiHandler<T> = ClientHandler<T> | TxHandler<T>

function getTransactorUrl(wsInfo: WorkspaceLoginInfo): string {
  return wsInfo.endpoint.replace('ws://', 'http://').replace('wss://', 'https://')
}

export async function selectWorkspace(ctx: ApiContext): Promise<WorkspaceLoginInfo>  {
    // TODO: clean cache and refresh token after some time
    const cacheKey = `${ctx.workspaceUrl}|${ctx.personUuid}`
    let wsInfo = cachedWorkspaces.get(cacheKey)
    if (wsInfo === undefined) {
      const token = encode(
        {
          account: ctx.personUuid ?? systemAccountUuid,
          extra: { service: 'schedule' }
        },
        process.env.SECRET ?? 'secret'
      )
      const client = getAccountClient(process.env.ACCOUNT_URL, token)
      log.debug('Select workspace:', ctx.workspaceUrl)
      wsInfo = await client.selectWorkspace(ctx.workspaceUrl)
      cachedWorkspaces.set(cacheKey, wsInfo)
      log.debug(`Workspace selected: ${wsInfo.workspace}, transactorUrl: ${getTransactorUrl(wsInfo)}`)
    }
    return wsInfo
}

async function apiCallRaw<T>(ctx: ApiContext, handler: ApiHandler<T>): Promise<ApiResult<T>> {
  try {
    let wsInfo = await selectWorkspace(ctx)
    let data: T
    if (handler.tx) {
      const client = await createRestTxOperations(getTransactorUrl(wsInfo), wsInfo.workspace, wsInfo.token)
      data = await handler.method(client, wsInfo)
    } else {
      const client = createRestClient(getTransactorUrl(wsInfo), wsInfo.workspace, wsInfo.token)
      data = await (handler as ClientHandler<T>).method(client, wsInfo)
    }
    return { ok: true, data }
  } catch (error: any) {
    log.error('Api error:', error)
    const err = `${error}`
    if (err.includes('platform:status:Forbidden')) {
      return { ok: false, status: 403 }
    }
    if (err.includes('platform:status:Unauthorized')) {
      return { ok: false, status: 401 }
    }
    if (err.includes('platform:status:AccountNotFound')) {
      return { ok: false, status: 404 }
    }
    if (err.includes('platform:status:WorkspaceNotFound')) {
      return { ok: false, status: 404 }
    }
    return { ok: false, status: error.status ?? 500 }
  }
}

export async function apiCall<T>(
  ctx: ApiContext,
  method: (client: RestClient, wsInfo: WorkspaceLoginInfo) => Promise<T>
): Promise<ApiResult<T>> {
  return apiCallRaw(ctx, { tx: false, method })
}

export async function apiCallTx<T>(
  ctx: ApiContext,
  method: (client: TxOperations, wsInfo: WorkspaceLoginInfo) => Promise<T>
): Promise<ApiResult<T>> {
  return apiCallRaw(ctx, { tx: true, method })
}
