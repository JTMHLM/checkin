const glados = async () => {
  const notice = []
  let hasError = false

  if (!process.env.GLADOS) {
    console.error('[GLaDOS] GLADOS secret is missing')
    process.exitCode = 1
    return [
      'Checkin Error',
      'GLADOS secret is missing',
      `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
    ]
  }

  // =========================
  // 读取多账号 Cookie / UA
  // =========================
  const cookies = String(process.env.GLADOS)
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)

  const agents = String(process.env.GLADOS_UA || '')
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)

  const domain = String(
    process.env.DOMAIN || 'glados.cloud'
  ).trim()

  console.log(`[GLaDOS] domain=${domain}`)
  console.log(`[GLaDOS] accounts=${cookies.length}`)
  console.log(`[GLaDOS] UA count=${agents.length}`)
  console.log(`[GLaDOS] UA configured=${agents.length > 0}`)

  // =========================
  // 逐账号签到
  // =========================
  for (const [index, cookie] of cookies.entries()) {
    const accountNo = index + 1

    try {
      // 多账号时按行对应 UA。
      // 如果只有一个 UA，则所有账号共用。
      const userAgent =
        agents[index] ||
        agents[0] ||
        'Mozilla/5.0'

      const commonHeaders = {
        'cookie': cookie,
        'referer': `https://${domain}/console/checkin`,
        'user-agent': userAgent,
        'accept': 'application/json, text/plain, */*',
      }

      console.log(
        `[GLaDOS] Account ${accountNo}: checking in...`
      )

      // =========================
      // Checkin
      // =========================
      const checkinResponse = await fetch(
        `https://${domain}/api/user/checkin`,
        {
          method: 'POST',
          headers: {
            ...commonHeaders,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            token: domain,
          }),
        }
      )

      const checkinText = await checkinResponse.text()

      let action

      try {
        action = JSON.parse(checkinText)
      } catch {
        throw new Error(
          `Checkin API returned non-JSON response ` +
          `(HTTP ${checkinResponse.status}): ` +
          checkinText.slice(0, 200)
        )
      }

      console.log(
        `[GLaDOS] Account ${accountNo}: ` +
        `HTTP=${checkinResponse.status}, ` +
        `code=${action?.code ?? 'N/A'}, ` +
        `message=${action?.message ?? 'N/A'}` +
        `${action?.reason ? `, reason=${action.reason}` : ''}`
      )

      if (!checkinResponse.ok) {
        throw new Error(
          `HTTP ${checkinResponse.status}: ` +
          `${action?.message || 'request failed'}`
        )
      }

      if (action?.code) {
        throw new Error(
          `${action?.message || 'Checkin failed'} ` +
          `(code=${action?.code}` +
          `${action?.reason ? `, reason=${action.reason}` : ''})`
        )
      }

      // =========================
      // 查询账号状态
      // =========================
      console.log(
        `[GLaDOS] Account ${accountNo}: getting status...`
      )

      const statusResponse = await fetch(
        `https://${domain}/api/user/status`,
        {
          method: 'GET',
          headers: commonHeaders,
        }
      )

      const statusText = await statusResponse.text()

      let status

      try {
        status = JSON.parse(statusText)
      } catch {
        throw new Error(
          `Status API returned non-JSON response ` +
          `(HTTP ${statusResponse.status}): ` +
          statusText.slice(0, 200)
        )
      }

      console.log(
        `[GLaDOS] Account ${accountNo}: status ` +
        `HTTP=${statusResponse.status}, ` +
        `code=${status?.code ?? 'N/A'}, ` +
        `message=${status?.message ?? 'N/A'}`
      )

      if (!statusResponse.ok) {
        throw new Error(
          `Status HTTP ${statusResponse.status}: ` +
          `${status?.message || 'request failed'}`
        )
      }

      if (status?.code) {
        throw new Error(
          `${status?.message || 'Status failed'} ` +
          `(code=${status?.code})`
        )
      }

      const leftDays = Number(
        status?.data?.leftDays
      )

      console.log(
        `[GLaDOS] Account ${accountNo}: SUCCESS, ` +
        `Left Days=${leftDays}`
      )

      notice.push(
        `Account ${accountNo} - Checkin OK`,
        `${action?.message || 'Checkin success'}`,
        `Left Days ${leftDays}`
      )

    } catch (error) {
      hasError = true

      const errorMessage =
        error?.message || String(error)

      console.error(
        `[GLaDOS] Account ${accountNo}: ERROR: ${errorMessage}`
      )

      notice.push(
        `Account ${accountNo} - Checkin Error`,
        `Error: ${errorMessage}`,
        `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      )
    }
  }

  // 不在这里直接 throw，
  // 先让通知函数把签到结果发送出去。
  if (hasError) {
    process.exitCode = 1
  }

  return notice
}


// ============================================================
// 通知
// ============================================================

const notify = async (notice) => {
  if (!process.env.NOTIFY || !notice) {
    return
  }

  const options = String(process.env.NOTIFY)
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)

  for (const option of options) {
    try {

      // =========================
      // Console
      // =========================
      if (option.startsWith('console:')) {
        console.log('========== NOTICE ==========')

        for (const line of notice) {
          console.log(line)
        }

        console.log('============================')
      }

      // =========================
      // WxPusher
      // =========================
      else if (option.startsWith('wxpusher:')) {
        const parts = option.split(':')

        const appToken = parts[1]
        const uids = parts.slice(2)

        const response = await fetch(
          'https://wxpusher.zjiecode.com/api/send/message',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              appToken,
              summary: notice[0],
              content: notice.join('<br>'),
              contentType: 3,
              uids,
            }),
          }
        )

        if (!response.ok) {
          throw new Error(
            `WxPusher HTTP ${response.status}`
          )
        }
      }

      // =========================
      // PushPlus
      // =========================
      else if (option.startsWith('pushplus:')) {
        const token = option.split(':')[1]

        const response = await fetch(
          'https://www.pushplus.plus/send',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              token,
              title: notice[0],
              content: notice.join('<br>'),
              template: 'markdown',
            }),
          }
        )

        if (!response.ok) {
          throw new Error(
            `PushPlus HTTP ${response.status}`
          )
        }
      }

      // =========================
      // Bark
      // =========================
      else if (option.startsWith('bark:')) {
        const key = option.split(':')[1]

        const response = await fetch(
          `https://api.day.app/${key}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              title: notice[0],
              body: notice.slice(1).join('\n'),
            }),
          }
        )

        if (!response.ok) {
          throw new Error(
            `Bark HTTP ${response.status}`
          )
        }
      }

      // =========================
      // 企业微信机器人
      // =========================
      else if (option.startsWith('qyweixin:')) {
        const qyweixinToken =
          option.split(':')[1]

        const url =
          'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' +
          qyweixinToken

        const response = await fetch(
          url,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              msgtype: 'markdown',
              markdown: {
                content: notice.join('<br>')
              }
            }),
          }
        )

        if (!response.ok) {
          throw new Error(
            `QYWX HTTP ${response.status}`
          )
        }

        const result = await response.json()

        if (
          result?.errcode !== undefined &&
          result.errcode !== 0
        ) {
          throw new Error(
            `QYWX errcode=${result.errcode}, ` +
            `errmsg=${result.errmsg}`
          )
        }
      }

      // =========================
      // 兼容旧版：
      // 只有 token 时默认 PushPlus
      // =========================
      else {
        const response = await fetch(
          'https://www.pushplus.plus/send',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              token: option,
              title: notice[0],
              content: notice.join('<br>'),
              template: 'markdown',
            }),
          }
        )

        if (!response.ok) {
          throw new Error(
            `PushPlus fallback HTTP ${response.status}`
          )
        }
      }

    } catch (error) {
      console.error(
        '[Notify] ERROR:',
        error?.message || error
      )

      // 通知失败也标记 Action 失败，
      // 但继续尝试其他通知渠道。
      process.exitCode = 1
    }
  }
}


// ============================================================
// Main
// ============================================================

const main = async () => {
  try {
    const result = await glados()

    await notify(result)

  } catch (error) {
    console.error(
      '[MAIN] Fatal error:',
      error?.message || error
    )

    process.exitCode = 1
  }
}

main()
