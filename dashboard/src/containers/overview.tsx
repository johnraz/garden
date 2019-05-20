/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import React, { useContext, useEffect } from "react"
import PageError from "../components/page-error"
import styled from "@emotion/styled"
import { ServiceIngress } from "garden-cli/src/types/service"
import { RunState } from "garden-cli/src/commands/get/get-status"
import Module from "../components/module"
import { default as ViewIngress } from "../components/view-ingress"
import { DataContext } from "../context/data"
import Spinner from "../components/spinner"
import { ServiceState } from "garden-cli/src/types/service"
import { UiStateContext } from "../context/ui"
import { getDuration } from "../util/helpers"

export const overviewConfig = {
  service: {
    height: "14rem",
  },
}

const Overview = styled.div`
    padding-top: .5rem;
`

const Modules = styled.div`
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  overflow-y: scroll;
  max-height: calc(100vh - 2rem);
  padding: 0 0 0 1rem;
`

export type ModuleModel = {
  name: string;
  type: string;
  path: string;
  description?: string;
  services: Service[];
  tests: Test[];
  tasks: Task[];
}
export type Entity = {
  name: string;
  isLoading: boolean;
  state: ServiceState | RunState;
}
export interface Service extends Entity {
  state: ServiceState
  ingresses?: ServiceIngress[]
}
export interface Test extends Entity {
  startedAt?: Date
  completedAt?: Date
  duration?: string
  state: RunState
}
export interface Task extends Entity {
  startedAt?: Date
  completedAt?: Date
  duration?: string
  state: RunState
}

// Note: We render the overview page components individually so we that we don't
// have to wait for both API calls to return.
export default () => {
  const {
    actions: { loadConfig, loadStatus },
    store: { config, status },
  } = useContext(DataContext)

  const {
    state: { overview: { selectedIngress } } } = useContext(UiStateContext)

  useEffect(loadConfig, [])
  useEffect(loadStatus, [])

  const isLoadingConfig = !config.data || config.loading

  let modulesContainerComponent: React.ReactNode = null
  let modules: ModuleModel[] = []

  if (config.error || status.error) {
    modulesContainerComponent = <PageError error={config.error || status.error} />
  } else if (isLoadingConfig) {
    modulesContainerComponent = <Spinner />
  } else if (config.data && config.data.moduleConfigs) {

    // fill modules with services names
    modules = config.data.moduleConfigs.map(moduleConfig => ({
      name: moduleConfig.name,
      type: moduleConfig.type,
      path: moduleConfig.path,
      description: moduleConfig.description,
      services: moduleConfig.serviceConfigs.map(service => ({
        name: service.name,
        isLoading: true,
      })) as Service[],
      tests: moduleConfig.testConfigs.map(test => ({
        name: test.name,
        isLoading: true,
      })) as Test[],
      tasks: moduleConfig.taskConfigs.map(task => ({
        name: task.name,
        isLoading: true,
      })) as Task[],
    }))

    // fill missing data from status
    if (status.data && status.data.services) {
      const servicesStatus = status.data.services
      const testsStatus = status.data.tests
      const tasksStatus = status.data.tasks
      for (let currModule of modules) {
        for (let serviceName of Object.keys(servicesStatus)) {
          const index = currModule.services.findIndex(s => s.name === serviceName)

          if (index !== -1) {
            currModule.services[index] = {
              ...currModule.services[index],
              state: servicesStatus[serviceName].state || "unknown",
              ingresses: servicesStatus[serviceName].ingresses,
              isLoading: false,
            }
          }
        }

        for (let testName of Object.keys(testsStatus)) {
          const index = currModule.tests.findIndex(t => t.name === testName.split(".")[1])

          if (index !== -1) {
            const testStatus = testsStatus[testName]
            currModule.tests[index] = {
              ...currModule.tests[index],
              state: testStatus.state || "outdated",
              isLoading: false,
              startedAt: testStatus.startedAt,
              completedAt: testStatus.completedAt,
              duration: testStatus.startedAt &&
                testStatus.completedAt &&
                getDuration(testStatus.startedAt, testStatus.completedAt),
            }
          }
        }

        for (let taskName of Object.keys(tasksStatus)) {
          const index = currModule.tasks.findIndex(t => t.name === taskName)

          if (index !== -1) {
            const taskStatus = tasksStatus[taskName]
            currModule.tasks[index] = {
              ...currModule.tasks[index],
              state: taskStatus.state || "outdated",
              isLoading: false,
              startedAt: taskStatus.startedAt,
              completedAt: taskStatus.completedAt,
              duration: taskStatus.startedAt &&
                taskStatus.completedAt &&
                getDuration(taskStatus.startedAt, taskStatus.completedAt),
            }
          }
        }
      }
    }

    modulesContainerComponent = (
      <Overview>
        <div className="row">
          <div className="col-xs">
            <Modules>
              {modules.map(module => (
                <Module module={module} key={module.name} />
              ))}
            </Modules>
          </div>
          {selectedIngress &&
            <div className="col-lg visible-lg-block">
              {selectedIngress &&
                <ViewIngress ingress={selectedIngress} width={"61.8vw"} />
              }
            </div>
          }

        </div>
      </Overview >
    )
  }

  return (
    <div>{modulesContainerComponent}</div>
  )
}
