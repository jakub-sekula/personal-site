import Link from "next/link";
import Image from "next/image";
// import { useState } from "react";

import { Layout, PageWrapper } from "@components/layout";
import { Tag } from "@components/common";
import { convertRelativeUrl } from "lib/utils";
// import { useRouter } from "next/navigation";

export default async function Projects() {
  const { data } = await getData();
  // const router = useRouter();
  // const [filter, setFilter] = useState("All projects");
  // const [filteredData, setFilteredData] = useState(data);
  const filter = "All projects";
  const filteredData = data;
  const filterList = [
    "All projects",
    ...new Set(data.map((item) => item.attributes.type)),
  ];

  return (
    <>
      <PageWrapper title="My projects">
        <div className="col-span-full flex justify-center gap-3">
          {filterList.map((item) => {
            return (
              <button
                key={`${item}-button`}
                className={`rounded-card w-36  px-4 py-2 text-sm transition-all  ease-out hover:-translate-y-px ${
                  filter === item ? "outline outline-js-yellow" : ""
                }`}
                // onClick={() => {
                //   setFilter(item);
                //   setFilteredData(
                //     data.filter((entry) =>
                //       item != "All projects"
                //         ? entry.attributes.type === item
                //         : item
                //     )
                //   );
                // }}
              >
                {item}
              </button>
            );
          })}
        </div>

        {filteredData.map((item) => (
          <Link href={`projects/${item.attributes.slug}`}
            key={item.attributes.slug}
            className="rounded-card hover-group group relative col-span-full flex w-full cursor-pointer
              flex-col overflow-hidden p-3 transition-all ease-in-out hover:-translate-y-1 md:col-span-4"
          >
            <Image
              priority
              src={convertRelativeUrl(
                item.attributes.featured_image.data.attributes.formats.medium
                  .url
              )}
              width={
                item.attributes.featured_image.data.attributes.formats.medium
                  .width
              }
              height={
                item.attributes.featured_image.data.attributes.formats.medium
                  .height
              }
              alt={item.attributes.featured_image.data.attributes.name}
              className="aspect-video w-full rounded-sm object-cover"
            />
            <h3
              href={`projects/${item.attributes.slug}`}
              className="animate-underline mb-2 mt-3 w-fit font-heading text-xl font-semibold"
            >
              {item.attributes.title}
            </h3>

            <p className="mb-4 text-sm font-light">{item.attributes.excerpt}</p>
            <div className="mt-auto flex w-full flex-wrap gap-2">
              {item.attributes.tools.data.map((tool) => {
                return (
                  <Tag
                    key={item.attributes.title + tool.attributes.name}
                    tag={tool}
                    noLink
                  />
                );
              })}
            </div>
          </Link>
        ))}
      </PageWrapper>
    </>
  );
}

async function getData() {
  const qs = require("qs");
  const headers = new Headers({
    Authorization: `Bearer ${process.env.STRAPI_TOKEN}`,
  });

  const query = qs.stringify({
    populate: {
      featured_image: true,
      tools: {
        populate: "*",
      },
    },
  });

  const res = await fetch(`http://localhost:1337/api/projects?${query}`, {
    headers,
  });

  const resJson = await res.json();

  console.log(resJson.data[0].attributes);

  return {
    data: resJson.data,
  };
}