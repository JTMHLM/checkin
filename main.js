const glados = async () => {
  const notice = []
  let hasError = false

  // ==========================================================
  // 检查 Secret
  // ==========================================================

  if (!process.env.GLADOS) {
    console.error('[GLaDOS] GLADOS secret is missing')

    process.exitCode = 1

    return [
      'Checkin Error',
      'GLADOS secret is missing',
      `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
    ]
  }

  // ==========================================================
  // 读取多账号 Cookie / UA
  //
  // GLADOS:
  // cookie_account_1
  // cookie_account_2
  //
  // GLADOS_UA:
  // ua_account_1
  // ua_account_2
  //
  // 如果 GLADOS_UA 只有一行，则所有账号共用这一 UA。
  // ==========================================================

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
  )
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')

  console.log(`[GLaDOS] domain=${domain}`)
  console.log(`[GLaDOS] accounts=${cookies.length}`)
  console.log(`[GLaDOS] UA count=${agents.length}`)
  console.log(`[GLaDOS] UA configured=${agents.length > 0}`)

  // ==========================================================
  // 检查是否属于“今天已经签到”
  // ==========================================================

  const isAlreadyChecked = (action) => {
    const message = String(action?.message || '').toLowerCase()

    const knownMessages = [
      "today's observation logged",
      'today’s observation logged',
      'checkin repeats',
      'check-in repeats',
      'already checked',
      'already checkin',
      'already checked in',
      'already signed',
    ]

    return knownMessages.some(text => message.includes(text))
  }

  // ==========================================================
  // 逐账号签到
  // ==========================================================

  for (const [index, cookie] of cookies.entries()) {
    const accountNo = index + 1

    try {
      const userAgent =
        agents[index] ||
        agents[0] ||
        'Mozilla/5.0'

      const commonHeaders = {
        cookie,
        referer: `https://${domain}/console/checkin`,
        'user-agent': userAgent,
        accept: 'application/json, text/plain, */*',
      }

      console.log(
        `[GLaDOS] Account ${accountNo}: checking in...`
      )

      // ======================================================
      // 签到 API
      // ======================================================

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

      const actionCode = action?.code

      console.log(
        `[GLaDOS] Account ${accountNo}: ` +
        `HTTP=${checkinResponse.status}, ` +
        `code=${actionCode ?? 'N/A'}, ` +
        `message=${action?.message ?? 'N/A'}` +
        `${action?.reason ? `, reason=${action.reason}` : ''}`
      )

      // HTTP 本身异常
      if (!checkinResponse.ok) {
        throw new Error(
          `HTTP ${checkinResponse.status}: ` +
          `${action?.message || 'request failed'}`
        )
      }

      // ======================================================
      // 判断签到结果
      //
      // code=0:
      //   正常签到成功
      //
      // code=1 + Today's observation logged:
      //   今天已经签到，不是错误
      //
      // code=-2:
      //   没有权限，Cookie / UA 等鉴权问题
      // ======================================================

      const alreadyChecked = isAlreadyChecked(action)

      const checkinSuccess =
        actionCode === 0 ||
        alreadyChecked

      if (!checkinSuccess) {
        throw new Error(
          `${action?.message || 'Checkin failed'} ` +
          `(code=${actionCode ?? 'unknown'}` +
          `${action?.reason ? `, reason=${action.reason}` : ''})`
        )
      }

      if (alreadyChecked) {
        console.log(
          `[GLaDOS] Account ${accountNo}: ` +
          `already checked today`
        )
      } else {
        console.log(
          `[GLaDOS] Account ${accountNo}: ` +
          `checkin accepted`
        )
      }

      // ======================================================
      // 查询账号状态
      // ======================================================

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

      // ======================================================
      // 剩余天数
      // ======================================================

      const leftDaysRaw = status?.data?.leftDays
      const leftDays = Number(leftDaysRaw)

      const leftDaysText =
        Number.isFinite(leftDays)
          ? leftDays
          : leftDaysRaw ?? 'N/A'

      const stateText =
        alreadyChecked
          ? 'Already checked today'
          : 'Checkin OK'

      console.log(
        `[GLaDOS] Account ${accountNo}: ` +
        `${alreadyChecked ? 'ALREADY CHECKED' : 'SUCCESS'}, ` +
        `Left Days=${leftDaysText}`
      )

      notice.push(
        `Account ${accountNo} - ${stateText}`,
        `${action?.message || stateText}`,
        `Left Days ${leftDaysText}`
      )

    } catch (error) {
      hasError = true

      const errorMessage =
        error?.message || String(error)

      console.error(
        `[GLaDOS] Account ${accountNo}: ` +
        `ERROR: ${errorMessage}`
      )

      notice.push(
        `Account ${accountNo} - Checkin Error`,
        `Error: ${errorMessage}`,
        `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      )
    }
  }

  // ==========================================================
  // 有任一账号真正失败，则最终 Action 标记失败。
  //
  // 不立即 throw，这样仍然可以先发送通知。
  // ==========================================================

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

      // ======================================================
      // Console
      // ======================================================

      if (option.startsWith('console:')) {
        console.log('')
        console.log('========== NOTICE ==========')

        for (const line of notice) {
          console.log(line)
        }

        console.log('============================')
        console.log('')
      }

      // ======================================================
      // WxPusher
      // 格式:
      // wxpusher:{token}:{uid}
      // ======================================================

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

      // ======================================================
      // PushPlus
      // 格式:
      // pushplus:{token}
      // ======================================================

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

      // ======================================================
      // Bark
      // 格式:
      // bark:{key}
      // ======================================================

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

      // ======================================================
      // 企业微信机器人
      // 格式:
      // qyweixin:{key}
      // ======================================================

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

      // ======================================================
      // 兼容旧版
      //
      // 如果 NOTIFY 中只有 token，没有前缀，
      // 默认按 PushPlus 处理。
      // ======================================================

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
      // 但继续尝试其余通知渠道。
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
