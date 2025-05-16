import type { APIRoute, APIContext } from 'astro'
import log from 'loglevel'
import calendar from '@hcengineering/calendar'
import core from '@hcengineering/core'
import type { CancelRequest } from '../../scripts/types'
import { apiCallTx } from '../../scripts/server/api'
import {
  getScheduleAndHost,
  getEventAndGuest,
  makeIcal,
  prepareEmailTemplateParams,
  sendEmail
} from '../../scripts/server/utils'

export const PUT: APIRoute = async ({ locals, request }: APIContext) => {
  const req: CancelRequest = await request.json()
  log.info('CANCEL', req)

  const { workspaceUrl } = req
  const now = new Date()

  const res = await apiCallTx({ workspaceUrl }, async (client) => {
    const { schedule, hostPerson, hostSocialId } = await getScheduleAndHost(client, req.scheduleId)
    const { event, guestPerson, participants } = await getEventAndGuest(
      client,
      req.calendarId,
      req.eventId,
      req.guestEmail
    )

    if (participants.length <= 2) {
      await client.removeDoc(
        calendar.class.Event,
        calendar.space.Calendar,
        event._id,
        now.getTime(),
        core.account.System,
      )
    } else {
      await client.updateDoc(
        calendar.class.Event,
        calendar.space.Calendar,
        event._id,
        {
          participants: event.participants.filter((p) => p !== guestPerson._id)
        },
        false,
        now.getTime(),
        core.account.System,
      )
    }

    const ical = makeIcal(
      schedule,
      event,
      guestPerson,
      participants,
      participants.length <= 2
        ? {
            canceled: true,
            sequence: 1
          }
        : {
            declined: guestPerson._id
          }
    )

    for (const p of participants) {
      const isGuest = p.person._id === guestPerson._id
      const templateParams = prepareEmailTemplateParams(
        isGuest
          ? {
              timeZone: req.timeZone,
              language: req.language
            }
          : {},
        'Meeting canceled',
        schedule,
        event,
        hostPerson,
        hostSocialId.value,
        guestPerson,
        req.guestEmail,
        {
          linkJoin: undefined,
          linkBook: isGuest ? `${req.originUrl}/${req.workspaceUrl}/${schedule._id}` : undefined
        }
      )

      // For testing with real calendar providers:
      const overrideTo = isGuest ? process.env.OVERRIDE_GUEST_EMAIL : process.env.OVERRIDE_HOST_EMAIL
      await sendEmail(overrideTo ?? p.email, templateParams, ical)
    }
  })
  if (!res.ok) {
    log.error('Error while canceling meeting', req, res)
    return new Response(JSON.stringify({ error: res.status }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
