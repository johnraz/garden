/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { PluginContext } from "../../../plugin-context"
import { LogEntry } from "../../../logger/log-entry"
import { KubernetesResource } from "../types"
import { helm } from "./helm-cli"
import { safeLoadAll } from "js-yaml"
import { KubeApi } from "../api"
import { getAppNamespace } from "../namespace"
import { checkResourceStatuses, waitForResources } from "../status/status"
import { combineStates } from "../../../types/service"
import { apply } from "../kubectl"
import { KubernetesProvider } from "../config"
import chalk from "chalk"

const serviceAccountName = "garden-tiller"

export async function checkTillerStatus(ctx: PluginContext, provider: KubernetesProvider, log: LogEntry) {
  const api = await KubeApi.factory(log, provider.config.context)
  const namespace = await getAppNamespace(ctx, log, provider)

  const resources = [
    ...getRoleResources(namespace),
    ...await getTillerResources(ctx, provider, log),
  ]

  const statuses = await checkResourceStatuses(api, namespace, resources, log)

  return combineStates(statuses.map(s => s.state))
}

interface InstallTillerParams {
  ctx: PluginContext
  provider: KubernetesProvider
  log: LogEntry
  force?: boolean
}

export async function installTiller({ ctx, log, provider, force = false }: InstallTillerParams) {
  if (!force && await checkTillerStatus(ctx, provider, log) === "ready") {
    return
  }

  const namespace = await getAppNamespace(ctx, log, provider)
  const context = provider.config.context

  const entry = log.info({
    section: "tiller",
    msg: `Installing to ${namespace}...`,
    status: "active",
  })

  // Need to install the RBAC stuff ahead of Tiller
  const roleResources = getRoleResources(namespace)
  entry.setState("Applying Tiller RBAC resources...")
  await apply({ log, context, manifests: roleResources, namespace })
  await waitForResources({ ctx, provider, serviceName: "tiller", resources: roleResources, log: entry })

  const tillerResources = await getTillerResources(ctx, provider, log)
  const pruneSelector = "app=helm,name=tiller"
  entry.setState("Deploying Tiller...")
  await apply({ log, context, manifests: tillerResources, namespace, pruneSelector })
  await waitForResources({ ctx, provider, serviceName: "tiller", resources: tillerResources, log: entry })

  entry.setSuccess({ msg: chalk.green(`Done (took ${entry.getDuration(1)} sec)`), append: true })
}

async function getTillerResources(
  ctx: PluginContext, provider: KubernetesProvider, log: LogEntry,
): Promise<KubernetesResource[]> {
  const namespace = await getAppNamespace(ctx, log, provider)
  const context = provider.config.context

  const tillerManifests = await helm(namespace, context, log,
    "init",
    "--service-account", serviceAccountName,
    "--dry-run",
    "--debug",
  )

  const resources = safeLoadAll(tillerManifests)

  return resources
}

function getRoleResources(namespace: string) {
  return [
    {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: {
        name: serviceAccountName,
        namespace,
      },
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: {
        name: serviceAccountName,
        namespace,
      },
      rules: [
        {
          apiGroups: ["*"],
          resources: ["*"],
          verbs: ["*"],
        },
      ],
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: {
        name: serviceAccountName,
        namespace,
      },
      roleRef: {
        kind: "Role",
        name: serviceAccountName,
        apiGroup: "rbac.authorization.k8s.io",
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: serviceAccountName,
          namespace,
        },
      ],
    },
    // TODO: either get rid of Tiller entirely, or find a more narrow (yet usable) way to limit permissions
    // cluster-wide. The reason for this is that often Helm charts contain cluster-scoped objects that are in practice
    // difficult to limit the creation of, especically for dev.
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRoleBinding",
      metadata: {
        name: serviceAccountName + "-cluster-admin",
      },
      roleRef: {
        kind: "ClusterRole",
        name: "cluster-admin",
        apiGroup: "rbac.authorization.k8s.io",
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: serviceAccountName,
          namespace,
        },
      ],
    },
  ]
}
