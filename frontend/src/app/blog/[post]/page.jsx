import Image from "next/image";
import Link from "next/link";
import { TableOfContents, MarkdownRenderer } from "@components/common";
import { convertRelativeUrl } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function Page({ params }) {
  const { data, author, featured_image } = await getData(params);
  return (
    <>
      <main className="mx-auto grid w-full max-w-page grid-cols-12">
        {/* Hero image */}
        {!!featured_image ? (
          <div
            key={`featured-image-${data.title}`}
            className="relative col-span-full mx-auto aspect-video max-h-[480px]
                     w-full overflow-hidden rounded-b-xl lg:col-span-10 lg:col-start-2
                     lg:mt-8 lg:rounded-xl"
          >
            <Image
              width={960}
              height={1667}
              alt={data.title}
              src={featured_image}
              priority={true}
              className="absolute h-full w-full object-cover"
            />
          </div>
        ) : null}

        {/* Title block */}
        <div
          className={`col-span-full px-6 pb-6 pt-8 md:col-span-8 md:col-start-3 lg:col-span-10 lg:col-start-2 lg:px-0 ${
            false ? "lg:col-span-6 lg:col-start-4" : "col-span-full"
          } `}
        >
          <div className="mb-4 block text-sm font-light">
            {author
              ? `Posted by ${author.firstname} ${author.lastname} • `
              : null}
            {new Date(data.createdAt).toLocaleDateString("en-gb")}
          </div>

          <div className="mb-2 flex gap-2">
            {!!data.tags
              ? data.tags.data.map((tag) => (
                  <Link
                    href={`/tags/${tag.attributes.slug}`}
                    className="rounded-sm bg-darkbg px-2 py-0.5 text-xs
                      text-darktext dark:bg-darktext dark:text-text"
                    key={`${tag.attributes.title}-${tag.id}`}
                  >
                    {tag.attributes.title}
                  </Link>
                ))
              : null}
          </div>

          <h1 className="-mb-3 font-heading text-3xl font-semibold tracking-tight ">
            {data.title}
          </h1>
        </div>

        {/* Post content in Markdown */}
        {data.content ? (
          <MarkdownRenderer>{data.content}</MarkdownRenderer>
        ) : null}

        {/* Table of contents */}
        <aside
          className="sticky top-20 col-span-3 col-start-9
                       row-start-3 hidden h-min lg:block"
        >
          <h4 className="mb-2 font-heading text-lg font-semibold">
            In this post:
          </h4>
          <ul className="font-light">
            <TableOfContents border={true} depth={2} />
          </ul>
        </aside>
      </main>
    </>
  );
}

async function getData(params) {
  try {
    const qs = require("qs");
    const { post } = params;
    let query;

    const headers = new Headers({
      Authorization: `Bearer ${process.env.STRAPI_TOKEN}`,
    });

    query = qs.stringify({
      filters: {
        slug: {
          $eq: post,
        },
      },
    });

    const idRes = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/posts?${query}`,
      {
        headers,
      }
    );
    const idJson = await idRes.json();

    const id = idJson?.data[0]?.id;

    if (!id) {
      return {
        notFound: true,
      };
    }

    query = qs.stringify({
      populate: {
        tags: true,
        sections: {
          populate: {
            gallery: true,
            featured_image: true,
          },
        },
        featured_image: {
          populate: "formats",
        },
        author: true,
      },
    });

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/posts/${id}?${query}`,
      {
        headers,
        next: { revalidate: 10 },
      }
    );

    const resJson = await res.json();

    return {
      data: resJson.data.attributes,
      author: resJson.data.attributes.author.data?.attributes || null,
      featured_image: !!resJson.data.attributes.featured_image.data
        ? convertRelativeUrl(
            resJson.data.attributes.featured_image.data?.attributes.url
          )
        : "",
    };
  } catch (err) {
    notFound();
  }
}

export async function generateStaticParams() {
  const headers = new Headers({
    Authorization: `Bearer ${process.env.STRAPI_TOKEN}`,
  });
  const posts = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/posts?pagination[pageSize]=50`,
    { headers }
  )
    .then((res) => res.json())
    .then((json) => json.data);
  return posts.map((post) => ({ project: post.attributes.slug }));
}
