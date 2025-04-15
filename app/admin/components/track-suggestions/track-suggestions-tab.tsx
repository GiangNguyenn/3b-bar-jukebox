'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function TrackSuggestionsTab(): JSX.Element {
  const [activeTab, setActiveTab] = useState('pending')

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <h2 className='text-2xl font-bold'>Track Suggestions</h2>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className='space-y-4'
      >
        <TabsList>
          <TabsTrigger value='pending'>Pending</TabsTrigger>
          <TabsTrigger value='approved'>Approved</TabsTrigger>
          <TabsTrigger value='rejected'>Rejected</TabsTrigger>
        </TabsList>

        <TabsContent value='pending'>
          <Card>
            <CardHeader>
              <CardTitle>Pending Suggestions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className='text-sm text-gray-400'>No pending suggestions</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='approved'>
          <Card>
            <CardHeader>
              <CardTitle>Approved Suggestions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className='text-sm text-gray-400'>No approved suggestions</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='rejected'>
          <Card>
            <CardHeader>
              <CardTitle>Rejected Suggestions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className='text-sm text-gray-400'>No rejected suggestions</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
