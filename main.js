const glados = async () => {
  const notice = []
  let hasError = false

  if (!process.env.GLADOS) {
    console.error('[GLaDOS] GLADOS secret is missing')
    process.exitCode = 1
    return ['Checkin Error', 'GLADOS secret is missing']
  }

  const cookies = String(process.env.GLADOS)
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)

  const agents = String(process.env.GLADOS_UA || '')
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)

  const domain = process.env.DOMAIN || 'glados.cloud'

  console.log(`[GLaDOS] domain=${domain}`)
  console.log(`[GLaDOS] accounts=${cookies.length}`)
  console.log(`[GLaDOS] UA configured=${agents.length > 0}`)

  for (const [index, cookie] of cookies.entries()) {
    const accountNo = index + 1

    try {
      const userAgent =
        agents[index] ||
        agents[0] ||
        'Mozilla/5.0'

      const common = {
        cookie,
        referer: `https://${domain}/console/checkin`,
        'user-agent': userAgent,
        accept: 'application/json, text/plain, */*',
      }

      console.log(`[GLaDOS] Account ${accountNo}: checking in...`)

      const checkinResponse = await fetch(
        `https://${domain}/api/user/checkin`,
        {
          method: 'POST',
          headers: {
            ...common,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ token: domain }),
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
        `message=${action?.message ?? 'N/A'}`
      )

      if (!checkinResponse.ok) {
        throw new Error(
          `HTTP ${checkinResponse.status}: ${action?.message || 'request failed'}`
        )
      }

      if (action?.code) {
        throw new Error(
          `${action?.message || 'Checkin failed'} ` +
          `(code=${action?.code}` +
          `${action?.reason ? `, reason=${action.reason}` : ''})`
        )
      }

      const statusResponse = await fetch(
        `https://${domain}/api/user/status`,
        {
          method: 'GET',
          headers: common,
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

      const leftDays = Number(status?.data?.leftDays)

      console.log(
        `[GLaDOS] Account ${accountNo}: SUCCESS, Left Days=${leftDays}`
      )

      notice.push(
        `Account ${accountNo} - Checkin OK`,
        `${action?.message}`,
        `Left Days ${leftDays}`
      )

    } catch (error) {
      hasError = true

      console.error(
        `[GLaDOS] Account ${accountNo}: ERROR:`,
        error?.message || error
      )

      notice.push(
        `Account ${accountNo} - Checkin Error`,
        `${error}`,
        `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      )
    }
  }

  // 让 GitHub Actions 真正显示失败，
  // 但先返回 notice，让通知仍然可以发送。
  if (hasError) {
    process.exitCode = 1
  }

  return notice
}

const main = async () => {
  try {
    const result = await glados()
    await notify(result)
  } catch (error) {
    console.error('[MAIN] Fatal error:', error)
    process.exitCode = 1
  }
}

main()
